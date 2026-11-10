//! The `flare-upload` program. The library holds all of it; see `cli`.

#![forbid(unsafe_code)]

use std::process::ExitCode;

fn main() -> ExitCode {
    let arguments = std::env::args_os().skip(1).collect();
    let mut system = flare_upload::cli::Machine;
    let code = flare_upload::cli::run(
        arguments,
        &mut system,
        &mut std::io::stdout().lock(),
        &mut std::io::stderr().lock(),
    );
    ExitCode::from(code)
}
