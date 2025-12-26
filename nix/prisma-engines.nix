{ stdenv
, lib
, fetchFromGitHub
, pkgconfig
, openssl
, zlib
, rustPlatform
, git
, releaseTag
, releaseSha
}:

rustPlatform.buildRustPackage rec {
  pname = "prisma-engines";
  version = releaseTag;

  src = fetchFromGitHub {
    owner = "prisma";
    repo = "prisma-engines";
    rev = releaseTag;
    sha256 = releaseSha;
  };

  cargoHash = "sha256-U5d/HkuWnD/XSrAJr5AYh+WPVGDOcK/e4sC0udPZoyU=";

  nativeBuildInputs = [ pkgconfig git ];
  buildInputs = [ openssl zlib ];

  doCheck = false;

  env = {
    GIT_HASH = releaseTag;
  };

  installPhase = ''
    mkdir -p $out/bin $out/lib

    copy_artifact() {
      local name=$1
      local dest=$2
      local path
      path=$(find . -path "*target*/*/$name" -print | head -n 1)

      if [ -z "$path" ]; then
        path=$(find . -name "$name" -print | head -n 1)
      fi

      if [ -z "$path" ]; then
        echo "error: could not find $name at target/release"
        exit 1
      fi

      cp "$path" "$dest/$name"
    }

    copy_artifact schema-engine $out/bin
    copy_artifact prisma-fmt $out/bin
  '';
}

