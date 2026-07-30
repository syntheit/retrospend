import json
import os
import re
import sys
from pathlib import Path

from transformers import AutoModelForSeq2SeqLM, AutoTokenizer


SOURCE = Path("messages/en.json")
TARGET = Path("messages/pt-BR.candidate-consistency.json")
MODEL_NAME = "Helsinki-NLP/opus-mt-tc-big-en-pt"

# Stable mainstream Brazilian software/finance terminology. These exact mappings
# also prevent terse labels from losing their intended part of speech in MT.
EXACT = {
    "Core": "Principal",
    "Shared": "Compartilhado",
    "Tools": "Ferramentas",
    "Dashboard": "Painel",
    "Transactions": "Transações",
    "Transaction": "Transação",
    "Budget": "Orçamento",
    "Budgets": "Orçamentos",
    "Recurring": "Recorrentes",
    "People": "Pessoas",
    "Person": "Pessoa",
    "Projects": "Projetos",
    "Project": "Projeto",
    "Import": "Importar",
    "Export": "Exportar",
    "Wealth": "Patrimônio",
    "Net Worth": "Patrimônio líquido",
    "Currencies": "Moedas",
    "Currency": "Moeda",
    "Add Expense": "Adicionar despesa",
    "Add expense": "Adicionar despesa",
    "Expense": "Despesa",
    "Expenses": "Despesas",
    "Settings": "Configurações",
    "Preferences": "Preferências",
    "Profile": "Perfil",
    "Categories": "Categorias",
    "Category": "Categoria",
    "Payment": "Pagamento",
    "Payments": "Pagamentos",
    "Notifications": "Notificações",
    "Security": "Segurança",
    "Privacy": "Privacidade",
    "Data": "Dados",
    "Account": "Conta",
    "Accounts": "Contas",
    "Cash": "Dinheiro",
    "Income": "Renda",
    "Balance": "Saldo",
    "Balances": "Saldos",
    "Amount": "Valor",
    "Date": "Data",
    "Description": "Descrição",
    "Name": "Nome",
    "Status": "Status",
    "Type": "Tipo",
    "Actions": "Ações",
    "Details": "Detalhes",
    "Overview": "Visão geral",
    "Analytics": "Análises",
    "Documentation": "Documentação",
    "Release Notes": "Notas da versão",
    "Feedback": "Feedback",
    "Admin Panel": "Painel administrativo",
    "Log out": "Sair",
    "Sign in": "Entrar",
    "Sign up": "Criar conta",
    "Cancel": "Cancelar",
    "Save": "Salvar",
    "Saving...": "Salvando...",
    "Saved": "Salvo",
    "Delete": "Excluir",
    "Deleting...": "Excluindo...",
    "Edit": "Editar",
    "Update": "Atualizar",
    "Updating...": "Atualizando...",
    "Create": "Criar",
    "Creating...": "Criando...",
    "Add": "Adicionar",
    "Remove": "Remover",
    "Close": "Fechar",
    "Done": "Concluído",
    "Continue": "Continuar",
    "Back": "Voltar",
    "Next": "Avançar",
    "Previous": "Anterior",
    "Confirm": "Confirmar",
    "Retry": "Tentar novamente",
    "Search": "Pesquisar",
    "Clear": "Limpar",
    "Reset": "Redefinir",
    "Apply": "Aplicar",
    "Copy": "Copiar",
    "Copied": "Copiado",
    "Download": "Baixar",
    "Upload": "Enviar arquivo",
    "View": "Ver",
    "View all": "Ver tudo",
    "Show": "Mostrar",
    "Hide": "Ocultar",
    "Enable": "Ativar",
    "Disable": "Desativar",
    "Enabled": "Ativado",
    "Disabled": "Desativado",
    "Active": "Ativo",
    "Inactive": "Inativo",
    "Pending": "Pendente",
    "Settled": "Acertado",
    "Settlement": "Acerto",
    "Settle up": "Acertar contas",
    "Split": "Dividir",
    "Split equally": "Dividir igualmente",
    "Your share": "Sua parte",
    "Paid": "Pago",
    "You paid": "Você pagou",
    "Paid by": "Pago por",
    "No category": "Sem categoria",
    "No description": "Sem descrição",
    "None": "Nenhum",
    "All": "Tudo",
    "Personal": "Pessoal",
    "Monthly": "Mensal",
    "Weekly": "Semanal",
    "Daily": "Diário",
    "Yearly": "Anual",
    "Today": "Hoje",
    "Yesterday": "Ontem",
    "Tomorrow": "Amanhã",
    "This month": "Este mês",
    "Last month": "Mês passado",
    "Custom": "Personalizado",
    "Default": "Padrão",
    "Optional": "Opcional",
    "Required": "Obrigatório",
    "Loading...": "Carregando...",
    "Something went wrong": "Algo deu errado",
    "Try again": "Tentar novamente",
    "Learn more": "Saiba mais",
    "Coming soon": "Em breve",
    "Unknown": "Desconhecido",
    "Never": "Nunca",
    "Yes": "Sim",
    "No": "Não",
    "On": "Ativado",
    "Off": "Desativado",
}

# Tokens that must remain byte-for-byte identical. ICU arguments are handled by
# the recursive message parser below and never enter the model.
TOKEN_RE = re.compile(
    r"("
    r"</?[A-Za-z][^>]*>"
    r"|https?://[^\s<>]+"
    r"|mailto:[^\s<>]+"
    r"|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}"
    r"|\b(?:Retrospend|Google|GitHub|Prisma|PostgreSQL|Vercel|Next\.js|"
    r"CSV|JSON|PDF|API|URL|UUID|IP|OAuth|Passkey|WebAuthn|2FA)\b"
    r"|\b(?:USD|EUR|GBP|JPY|CNY|BRL|ARS|CAD|AUD|CHF|RUB|UAH|PLN|TRY|"
    r"BTC|ETH)\b"
    r"|\b(?:Ctrl|Cmd|Alt|Shift|Enter|Escape|Esc|Tab)\s*(?:\+\s*[A-Za-z0-9]+)+"
    r"|(?:YYYY|MM|DD)(?:[-/.](?:YYYY|MM|DD))+"
    r"|#[A-Za-z0-9_-]+"
    r"|`[^`]+`"
    r")"
)

ENGLISH_WORD_RE = re.compile(r"[A-Za-z]")
TRANSLATABLE_RE = re.compile(r"[A-Za-zÀ-ÿ]")


def matching_brace(text: str, start: int) -> int:
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i
    raise ValueError(f"Unbalanced ICU brace: {text!r}")


def top_level_commas(inner: str) -> list[int]:
    result = []
    depth = 0
    for i, ch in enumerate(inner):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif ch == "," and depth == 0:
            result.append(i)
    return result


def split_plain(text: str, pieces: list[dict]) -> list[tuple[str, object]]:
    """Split literal text into protected tokens and independently translated spans."""
    result: list[tuple[str, object]] = []
    pos = 0
    for match in TOKEN_RE.finditer(text):
        if match.start() > pos:
            result.extend(add_text_piece(text[pos : match.start()], pieces))
        result.append(("raw", match.group(0)))
        pos = match.end()
    if pos < len(text):
        result.extend(add_text_piece(text[pos:], pieces))
    return result


def add_text_piece(text: str, pieces: list[dict]) -> list[tuple[str, object]]:
    # Keep whitespace/punctuation-only spans exactly as authored.
    if not TRANSLATABLE_RE.search(text):
        return [("raw", text)]
    idx = len(pieces)
    pieces.append({"source": text, "translation": None})
    return [("piece", idx)]


def parse_plural_options(rest: str, pieces: list[dict]) -> list[tuple[str, object]]:
    result: list[tuple[str, object]] = []
    pos = 0
    while pos < len(rest):
        brace = rest.find("{", pos)
        if brace == -1:
            result.append(("raw", rest[pos:]))
            break
        # Header includes whitespace and selector (=0, one, other, etc.).
        result.append(("raw", rest[pos : brace + 1]))
        end = matching_brace(rest, brace)
        result.extend(parse_message(rest[brace + 1 : end], pieces))
        result.append(("raw", "}"))
        pos = end + 1
    return result


def parse_argument(argument: str, pieces: list[dict]) -> list[tuple[str, object]]:
    commas = top_level_commas(argument)
    if len(commas) < 2:
        return [("raw", "{" + argument + "}")]
    arg_type = argument[commas[0] + 1 : commas[1]].strip()
    if arg_type not in {"plural", "selectordinal", "select"}:
        return [("raw", "{" + argument + "}")]
    prefix = argument[: commas[1] + 1]
    rest = argument[commas[1] + 1 :]
    return [("raw", "{" + prefix)] + parse_plural_options(rest, pieces) + [
        ("raw", "}")
    ]


def parse_message(text: str, pieces: list[dict]) -> list[tuple[str, object]]:
    result: list[tuple[str, object]] = []
    pos = 0
    while pos < len(text):
        brace = text.find("{", pos)
        if brace == -1:
            result.extend(split_plain(text[pos:], pieces))
            break
        if brace > pos:
            result.extend(split_plain(text[pos:brace], pieces))
        end = matching_brace(text, brace)
        result.extend(parse_argument(text[brace + 1 : end], pieces))
        pos = end + 1
    return result


def render(template: list[tuple[str, object]], pieces: list[dict]) -> str:
    out = []
    for kind, value in template:
        out.append(str(value) if kind == "raw" else pieces[int(value)]["translation"])
    return "".join(out)


def ptbr_cleanup(source: str, target: str) -> str:
    # European Portuguese artifacts and dated literal translations.
    replacements = [
        (r"\bficheiros\b", "arquivos"),
        (r"\bficheiro\b", "arquivo"),
        (r"\bFicheiros\b", "Arquivos"),
        (r"\bFicheiro\b", "Arquivo"),
        (r"\becrãs\b", "telas"),
        (r"\becrã\b", "tela"),
        (r"\bEcrãs\b", "Telas"),
        (r"\bEcrã\b", "Tela"),
        (r"\butilizadores\b", "usuários"),
        (r"\butilizador\b", "usuário"),
        (r"\bUtilizadores\b", "Usuários"),
        (r"\bUtilizador\b", "Usuário"),
        (r"\bpalavras-passe\b", "senhas"),
        (r"\bpalavra-passe\b", "senha"),
        (r"\bPalavras-passe\b", "Senhas"),
        (r"\bPalavra-passe\b", "Senha"),
        (r"\btelemóvel\b", "celular"),
        (r"\bequipa\b", "equipe"),
        (r"\bequipas\b", "equipes"),
        (r"\bEquipa\b", "Equipe"),
        (r"\bEquipas\b", "Equipes"),
        (r"\ba sua\b", "sua"),
        (r"\bo seu\b", "seu"),
        (r"\bas suas\b", "suas"),
        (r"\bos seus\b", "seus"),
    ]
    for pattern, replacement in replacements:
        target = re.sub(pattern, replacement, target)

    lower = source.lower()
    # Enforce the candidate's cross-app finance glossary.
    if "net worth" in lower:
        target = re.sub(
            r"\b(?:valor|riqueza|patrimônio)\s+líquid[oa]\b",
            "patrimônio líquido",
            target,
            flags=re.I,
        )
    if "wealth" in lower:
        target = re.sub(r"\briqueza\b", "patrimônio", target, flags=re.I)
    if re.search(r"\bexpenses?\b", lower):
        target = re.sub(r"\bgastos\b", "despesas", target, flags=re.I)
        target = re.sub(r"\bgasto\b", "despesa", target, flags=re.I)
    if re.search(r"\bsettlements?\b", lower):
        target = re.sub(r"\bliquidações\b", "acertos", target, flags=re.I)
        target = re.sub(r"\bliquidação\b", "acerto", target, flags=re.I)
    if re.search(r"\bcash\b", lower):
        target = re.sub(r"\bnumerário\b", "dinheiro", target, flags=re.I)
    # UI ellipses should follow the source, not model punctuation habits.
    if source.rstrip().endswith("...") and not target.rstrip().endswith("..."):
        target = target.rstrip().rstrip(".") + "..."
    return target


def flatten(value, path=()):
    if isinstance(value, str):
        yield path, value
    else:
        for key, child in value.items():
            yield from flatten(child, path + (key,))


def assign(root, path, value):
    node = root
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value


def main():
    source = json.loads(SOURCE.read_text())
    result = json.loads(SOURCE.read_text())
    entries = []
    all_pieces: list[dict] = []

    for path, message in flatten(source):
        if message in EXACT:
            entries.append((path, message, None, EXACT[message]))
            continue
        template = parse_message(message, all_pieces)
        entries.append((path, message, template, None))

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, local_files_only=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME, local_files_only=True)
    model.eval()

    import torch

    batch_size = 32
    pending = [
        (i, piece["source"])
        for i, piece in enumerate(all_pieces)
        if TRANSLATABLE_RE.search(piece["source"])
    ]
    print(
        f"Translating {len(entries)} leaves as {len(pending)} protected literal segments",
        flush=True,
    )
    with torch.inference_mode():
        for offset in range(0, len(pending), batch_size):
            batch = pending[offset : offset + batch_size]
            texts = [text.strip() for _, text in batch]
            encoded = tokenizer(
                texts,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=384,
            )
            generated = model.generate(
                **encoded,
                max_new_tokens=384,
                num_beams=3,
                early_stopping=True,
                renormalize_logits=True,
            )
            translated = tokenizer.batch_decode(generated, skip_special_tokens=True)
            for (idx, original), text in zip(batch, translated):
                leading = original[: len(original) - len(original.lstrip())]
                trailing = original[len(original.rstrip()) :]
                all_pieces[idx]["translation"] = leading + text.strip() + trailing
            done = min(offset + batch_size, len(pending))
            if done % 320 == 0 or done == len(pending):
                print(f"{done}/{len(pending)} segments", flush=True)

    for path, message, template, fixed in entries:
        translated = fixed if fixed is not None else render(template, all_pieces)
        translated = ptbr_cleanup(message, translated)
        assign(result, path, translated)

    TARGET.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {TARGET}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
