{
  description = "Development shell for Retrospend / Prisma 7";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = forAllSystems (system: import nixpkgs { inherit system; });
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor.${system};

          # Only compile custom engines on Linux to preserve NixOS behavior
          # On macOS, we rely on the nixpkgs version or potentially auto-downloaded binaries if needed
          # though defining proper env vars is preferred.
          prismaVersion = "7.3.0";
          prismaSha = "sha256-a4skrL5r6tfFMMD+yikm5wgkiAOXom6FC5fuAYPzT5I=";

          prismaEngines =
            if pkgs.stdenv.isLinux then
              pkgs.callPackage ./nix/prisma-engines.nix {
                inherit (pkgs)
                  rustPlatform
                  openssl
                  zlib
                  git
                  ;
                pkgconfig = pkgs."pkg-config";
                releaseTag = prismaVersion;
                releaseSha = prismaSha;
              }
            else
              pkgs.prisma-engines;

        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.nodePackages.pnpm
              pkgs.openssl
              pkgs.postgresql
              pkgs.go
              prismaEngines
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
              pkgs.libiconv
            ];

            shellHook = ''
              ${pkgs.lib.optionalString pkgs.stdenv.isLinux "export LD_LIBRARY_PATH=${
                pkgs.lib.makeLibraryPath [ pkgs.openssl ]
              }:${prismaEngines}/lib"}

              export PRISMA_SCHEMA_ENGINE_BINARY="${prismaEngines}/bin/schema-engine"
              export PRISMA_QUERY_ENGINE_BINARY="${prismaEngines}/bin/query-engine"
              export PRISMA_QUERY_ENGINE_LIBRARY="${prismaEngines}/lib/libquery_engine.node"
              export PRISMA_FMT_BINARY="${prismaEngines}/bin/prisma-fmt"
              export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

              echo "Retrospend dev shell ready (Prisma engines from ${prismaEngines})"
            '';
          };
        }
      );
    };
}
