{
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShell {
        nativeBuildInputs = with pkgs; [
          nodejs_22
          nodePackages.pnpm
        ];

        # Esto es ORO: permite que los binarios que descarga pnpm
        # encuentren las librerías del sistema en NixOS.
        shellHook = ''
          export LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ]}
          echo "pnpm Dev Environment Ready"
        '';
      };
    };
}y