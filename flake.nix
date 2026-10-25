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
          # Patched schema engine matching the Prisma version in pnpm-lock.yaml.
          # Downloaded engines can't run on NixOS. Bump the hash after every
          # Prisma upgrade (set it to "" and nix prints the new one).
          prisma = prisma-utils.lib.prisma-factory {
            inherit pkgs;
            hash = "sha256-eH8L06UrRXMDZTF1RpCRkGhhGW4HP70jO+ETZH74Qu8=";
            pnpmLock = ./pnpm-lock.yaml;
          };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_24
              # pnpm switches itself to the packageManager version. pnpm 12 does
              # it through @pnpm/exe, a native binary NixOS cannot run.
              pnpm_10
              go
              openssl
              pkg-config
            ];

            # Prisma 7 formats via WASM, so only the schema engine is needed.
            env = {
              inherit (prisma.env) PRISMA_SCHEMA_ENGINE_BINARY;
              PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";
              # Let sharp use its own prebuilt libvips instead of detecting system one
              SHARP_IGNORE_GLOBAL_LIBVIPS = "1";
            };

            shellHook = ''
              # The glibc biome binary from npm can't run on NixOS; the static musl one can
              for b in "$PWD"/node_modules/.pnpm/@biomejs+cli-linux-x64-musl@*/node_modules/@biomejs/cli-linux-x64-musl/biome; do
                [ -x "$b" ] && export BIOME_BINARY="$b"
              done
              echo "Retrospend dev shell"
              echo "  Node.js $(node --version) · pnpm $(pnpm --version) · Go $(go version | cut -d' ' -f3)"
            '';
          };
        }
        # Android builds for the Expo app (stream 5). Google publishes the SDK
        # tools for x86_64 Linux and macOS only.
        // nixpkgs.lib.optionalAttrs (system != "aarch64-linux") {
          android =
            let
              androidPkgs = import nixpkgs {
                inherit system;
                config = {
                  allowUnfree = true;
                  android_sdk.accept_license = true;
                };
              };
              # The versions React Native 0.88 (Expo SDK 58) builds with: compileSdk 37,
              # build-tools 37.0.0 (targetSdk stays 36).
              # Build-tools 35 too: Android libraries that set no
              # buildToolsVersion get AGP 8.12's default (35.0.0), and Gradle
              # cannot install it into the read-only store.
              sdk =
                (androidPkgs.androidenv.composeAndroidPackages {
                  platformVersions = [
                    "36"
                    "37"
                  ];
                  buildToolsVersions = [
                    "37.0.0"
                    "36.0.0"
                    "35.0.0"
                  ];
                  includeNDK = true;
                  ndkVersions = [ "27.1.12297006" ];
                  cmakeVersions = [ "3.22.1" ];
                }).androidsdk;
              # The SDK's prebuilt ninja segfaults on NixOS, and AGP always runs
              # the one next to its CMake. This SDK root links everything from
              # the composed SDK but swaps that ninja for nixpkgs' own.
              cmakeBin = "cmake/3.22.1/bin";
              androidHome = androidPkgs.runCommand "android-sdk-with-ninja" { } ''
                src=${sdk}/libexec/android-sdk
                mkdir -p $out/${cmakeBin}
                for f in $src/*; do [ "$f" = $src/cmake ] || ln -s "$f" $out/; done
                for f in $src/cmake/3.22.1/*; do
                  [ "$f" = $src/${cmakeBin} ] || ln -s "$f" $out/cmake/3.22.1/
                done
                for f in $src/${cmakeBin}/*; do ln -s "$f" $out/${cmakeBin}/; done
                ln -sf ${androidPkgs.ninja}/bin/ninja $out/${cmakeBin}/ninja
              '';
            in
            androidPkgs.mkShell {
              packages = with androidPkgs; [
                nodejs_24
                pnpm_10
                jdk17
                sdk
              ];
              env = {
                JAVA_HOME = androidPkgs.jdk17.home;
                ANDROID_HOME = "${androidHome}";
                ANDROID_NDK_ROOT = "${androidHome}/ndk-bundle";
                # Gradle's own aapt2 download is a dynamic binary NixOS cannot run.
                GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidHome}/build-tools/36.0.0/aapt2";
              };
            };
        }
      );
    };
}
