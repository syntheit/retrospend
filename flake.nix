{
  description = "Retrospend dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    prisma-utils.url = "github:VanCoding/nix-prisma-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      prisma-utils,
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          prisma = prisma-utils.lib.prisma-factory {
            inherit pkgs;
            hash = "sha256-H3iZMOF0JJ2dUUGwhu3zPfRMX3gjWkhnJSHYSSsh8i4=";
            pnpmLock = ./pnpm-lock.yaml;
          };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_22
              pnpm
              go
              openssl
              pkg-config
            ];

            env = prisma.env // {
              PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";
              # Let sharp use its own prebuilt libvips instead of detecting system one
              SHARP_IGNORE_GLOBAL_LIBVIPS = "1";
            };

            shellHook = ''
              echo "Retrospend dev shell"
              echo "  Node.js $(node --version) · pnpm $(pnpm --version) · Go $(go version | cut -d' ' -f3)"
            '';
          };
        }
      );
    };
}
