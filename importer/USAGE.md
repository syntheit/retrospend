# Importer Worker Guide

The Importer Worker is a specialized service that processes financial statements (PDF and CSV) using a combination of traditional parsing and LLM-based extraction/enrichment.

## Running the Worker

### Using Docker (Recommended)

The worker is designed to run alongside an Ollama instance. Use the project's root `docker-compose.yml`:

```bash
docker compose up -d importer ollama
```

### Environment Variables

Configure these in your `.env` file:

- `WORKER_API_KEY`: A secure token for authenticating requests.
- `OLLAMA_ENDPOINT`: The URL to your Ollama API (e.g., `http://ollama:11434/api/generate`).
- `LLM_MODEL`: The model to use (default: `qwen2.5:7b`).
- `PORT`: The port the worker listens on (default: `8080`).

## API Usage

All requests must include the `Authorization: Bearer <your-api-key>` header.

### POST /process

Processes a single CSV or PDF file and returns a JSON array of normalized transactions.

**Request:** `multipart/form-data`

- `file`: The statement file to process.

**Example using `curl`:**

```bash
curl -X POST http://localhost:8082/process \
  -H "Authorization: Bearer your-api-key" \
  -F "file=@/path/to/statement.pdf"
```

**Response:**

```json
[
  {
    "title": "Uber",
    "amount": 12.5,
    "currency": "USD",
    "date": "2024-02-15",
    "category": "Transport",
    "location": "New York, NY",
    "description": "Uber Trip",
    "amountInUSD": 12.5,
    "exchangeRate": 1.0
  }
]
```

## Local Development

If running locally without Docker:

1. Ensure `poppler-utils` is installed (for `pdftotext`).
2. Have Ollama running locally.
3. Set the environment variables.
4. Run:
   ```bash
   go run cmd/worker/main.go
   ```
