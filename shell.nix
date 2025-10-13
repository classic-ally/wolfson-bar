{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    # Rust backend
    rustc
    cargo
    openssl
    pkg-config

    # Node.js frontend
    nodejs_20
    pnpm
  ];

  # Backend environment variables
  OPENSSL_DIR = "${pkgs.openssl.dev}";
  OPENSSL_LIB_DIR = "${pkgs.openssl.out}/lib";
  OPENSSL_INCLUDE_DIR = "${pkgs.openssl.dev}/include";
  PUBLIC_URL = "http://localhost:3000";

  shellHook = ''
    echo "🍺 Wolfson Bar Development Environment"
    echo "📍 PUBLIC_URL: $PUBLIC_URL"
    echo ""
    echo "Backend:  cd backend && cargo run"
    echo "Frontend: cd frontend && pnpm dev"
  '';
}
