{
  description = "Development shell for Retrospend / Prisma 7";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      prismaVersion = "7.2.0";
      prismaSha = "sha256-1CwpUtNuqxGNjBmmmo/Aet8XrmnCQfDToI7vZaNupDI=";
      prismaEngines = pkgs.callPackage ./nix/prisma-engines.nix {
        inherit (pkgs) rustPlatform openssl zlib git;
        pkgconfig = pkgs."pkg-config";
        releaseTag = prismaVersion;
        releaseSha = prismaSha;
      };
    in {
      packages.${system}.prismaEngines = prismaEngines;

      devShells.${system}.default = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs_22
          pkgs.nodePackages.pnpm
          pkgs.openssl
          pkgs.postgresql
          prismaEngines
        ];

        shellHook = ''
          export LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath [ pkgs.openssl ]}:${prismaEngines}/lib
          export PRISMA_SCHEMA_ENGINE_BINARY="${prismaEngines}/bin/schema-engine"
          export PRISMA_QUERY_ENGINE_BINARY="${prismaEngines}/bin/query-engine"
          export PRISMA_QUERY_ENGINE_LIBRARY="${prismaEngines}/lib/libquery_engine.node"
          export PRISMA_FMT_BINARY="${prismaEngines}/bin/prisma-fmt"
          export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
          echo "Retrospend dev shell ready (Prisma engines from ${prismaEngines})"
        '';
      };
    };
}