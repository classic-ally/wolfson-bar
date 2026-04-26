{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, rust-overlay, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = fn: nixpkgs.lib.genAttrs systems (system:
        fn (import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        })
      );
    in
    {
      packages = forAllSystems (pkgs:
        let
          rustPlatform = pkgs.makeRustPlatform {
            cargo = pkgs.rust-bin.stable.latest.default;
            rustc = pkgs.rust-bin.stable.latest.default;
          };

          # ts-rs bindings emitted by `cargo test`. Output is the directory
          # containing all *.ts files for frontend/src/types/. We piggyback on
          # rustPlatform's cargo-deps fetcher (via `cargoDeps`) but skip the
          # install hooks since we're not producing a binary.
          ts-bindings = pkgs.stdenv.mkDerivation {
            pname = "wolfson-bar-ts-bindings";
            version = "0.1.0";
            src = ./backend;

            cargoDeps = rustPlatform.fetchCargoVendor {
              src = ./backend;
              hash = "sha256-Hjf4XbzkaSVi4zqZZPe6U/bmCHs4cDqn7FBHaKKzU3E=";
            };

            nativeBuildInputs = [
              pkgs.rust-bin.stable.latest.default
              rustPlatform.cargoSetupHook
              pkgs.pkg-config
            ];
            buildInputs = [ pkgs.openssl ];

            buildPhase = ''
              runHook preBuild
              mkdir -p $out
              TS_RS_EXPORT_DIR=$out cargo test --release --quiet --tests export_bindings_
              runHook postBuild
            '';

            dontInstall = true;
            doCheck = false;
          };

          frontend = pkgs.stdenvNoCC.mkDerivation {
            pname = "wolfson-bar-frontend";
            version = "0.1.0";
            src = ./frontend;

            pnpmDeps = pkgs.fetchPnpmDeps {
              pname = "wolfson-bar-frontend";
              version = "0.1.0";
              src = ./frontend;
              fetcherVersion = 3;
              hash = "sha256-dKjKLYNVRfapg3mmTI5Gtq4lIR9F60DFPQeaFDt+MwE=";
            };

            nativeBuildInputs = [ pkgs.nodejs pkgs.pnpm_10 pkgs.pnpmConfigHook ];

            preBuild = ''
              mkdir -p src/types
              cp ${ts-bindings}/*.ts src/types/
            '';

            buildPhase = ''
              runHook preBuild
              # Skip pnpm lifecycle scripts (prebuild runs cargo, not available here);
              # types are already in place via preBuild above.
              pnpm exec vite build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              cp -r dist $out
              runHook postInstall
            '';
          };

          wolfson-bar = rustPlatform.buildRustPackage {
            pname = "wolfson-bar";
            version = "0.1.0";
            src = ./backend;

            cargoLock.lockFile = ./backend/Cargo.lock;

            nativeBuildInputs = [ pkgs.pkg-config ];
            buildInputs = [ pkgs.openssl ];

            doCheck = false;
          };

          # Runtime bundle with binary, migrations, and frontend assets
          runtime = pkgs.stdenvNoCC.mkDerivation {
            pname = "wolfson-bar-runtime";
            version = "0.1.0";
            dontUnpack = true;

            installPhase = ''
              mkdir -p $out/frontend/dist
              ln -s ${wolfson-bar}/bin/wolfson-bar-backend $out/backend
              cp -r ${frontend}/* $out/frontend/dist/
            '';
          };
        in {
          inherit runtime;
          default = wolfson-bar;
        } // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          dockerImage = pkgs.dockerTools.buildLayeredImage {
            name = "wolfson-bar";
            tag = "latest";
            contents = [ runtime ];
            config = {
              Entrypoint = [ "${runtime}/backend" ];
              ExposedPorts."3000/tcp" = {};
              Env = [
                "FRONTEND_PATH=${runtime}/frontend/dist"
              ];
              WorkingDir = "${runtime}";
            };
          };
        }
      );

      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.wolfson-bar;
          runtime = self.packages.${pkgs.system}.runtime;
        in {
          options.services.wolfson-bar = {
            enable = lib.mkEnableOption "Wolfson Bar";

            publicUrl = lib.mkOption {
              type = lib.types.str;
              description = "Public URL for WebAuthn (e.g. https://wolfson.bar)";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 3000;
              description = "Port to listen on";
            };

            stateDir = lib.mkOption {
              type = lib.types.str;
              default = "/var/lib/wolfson-bar";
              description = "Directory for the SQLite database";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.wolfson-bar = {
              description = "Wolfson Bar";
              after = [ "network.target" ];
              wantedBy = [ "multi-user.target" ];

              environment = {
                PUBLIC_URL = cfg.publicUrl;
                FRONTEND_PATH = "${runtime}/frontend/dist";
              };

              serviceConfig = {
                Type = "simple";
                ExecStart = "${runtime}/backend";
                WorkingDirectory = cfg.stateDir;
                StateDirectory = "wolfson-bar";
                DynamicUser = true;
                Restart = "on-failure";
                RestartSec = 5;
              };
            };
          };
        };

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          buildInputs = [
            (pkgs.rust-bin.stable.latest.default.override {
              extensions = [ "clippy" "rust-src" ];
            })
            pkgs.rust-analyzer

            pkgs.openssl.dev
            pkgs.pkg-config

            pkgs.nodejs_24
            pkgs.pnpm
          ];

          OPENSSL_DIR = "${pkgs.openssl.dev}";
          OPENSSL_LIB_DIR = "${pkgs.openssl.out}/lib";
          OPENSSL_INCLUDE_DIR = "${pkgs.openssl.dev}/include";
          PUBLIC_URL = "http://localhost:5173";

          shellHook = ''
            echo "🍺 Wolfson Bar Development Environment"
            echo "📍 PUBLIC_URL: $PUBLIC_URL"
            echo ""
            echo "Backend:  cd backend && cargo run"
            echo "Frontend: cd frontend && pnpm dev"
            echo ""
            # Emit ts-rs bindings if missing so tsc has them on first open.
            if [ ! -f frontend/src/types/UserStatus.ts ]; then
              echo "Generating ts-rs bindings (first run, may take a moment)..."
              (cd backend && cargo test --quiet --tests export_bindings_) && \
                echo "Bindings ready. Re-run this hook or 'pnpm gen-types' after schema changes."
            fi
          '';
        };
      });
    };
}
