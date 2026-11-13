{
  description = "Dependency-free Maple Buzz plugin development";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  outputs = { self, nixpkgs }:
    let systems = [ "aarch64-darwin" "x86_64-linux" "aarch64-linux" ];
    in { devShells = nixpkgs.lib.genAttrs systems (system:
      let pkgs = import nixpkgs { inherit system; };
      in { default = pkgs.mkShell { packages = [ pkgs.nodejs_24 ]; }; }); };
}
