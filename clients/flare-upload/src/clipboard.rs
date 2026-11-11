//! Copies the share link with the clipboard program of the system, and
//! opens it in the browser. Both fail soft: the link is on standard output
//! already, so a missing program is a warning and not a failed upload.
//!
//! The link goes to the program through its standard input, never as an
//! argument: the arguments of a process are visible to other users.

use std::io::Write;
use std::process::{Command, Stdio};

/// The programs to try, in sequence, with their arguments.
pub fn clipboard_commands(
    os: &str,
    env: &dyn Fn(&str) -> Option<String>,
) -> Vec<(&'static str, Vec<&'static str>)> {
    let set = |name: &str| env(name).is_some_and(|value| !value.is_empty());
    match os {
        "windows" => vec![("clip", vec![])],
        "macos" => vec![("pbcopy", vec![])],
        _ => {
            let wayland = ("wl-copy", vec![]);
            let x11 = [
                ("xclip", vec!["-selection", "clipboard"]),
                ("xsel", vec!["--clipboard", "--input"]),
            ];
            let mut commands = Vec::new();
            if set("WAYLAND_DISPLAY") {
                commands.push(wayland);
                commands.extend(x11);
            } else {
                commands.extend(x11);
                commands.push(wayland);
            }
            commands
        }
    }
}

fn pipe_to(program: &str, arguments: &[&str], text: &str) -> std::io::Result<bool> {
    let mut child = Command::new(program)
        .args(arguments)
        .stdin(Stdio::piped())
        // xclip and wl-copy keep running to serve the selection. A pipe here
        // would make this program wait for them.
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes())?;
    }
    Ok(child.wait()?.success())
}

/// Copies `text` to the clipboard. Returns the program that took it.
pub fn copy_to_clipboard(text: &str) -> Result<&'static str, String> {
    let commands = clipboard_commands(std::env::consts::OS, &|name| std::env::var(name).ok());
    let mut tried = Vec::new();
    for (program, arguments) in commands {
        match pipe_to(program, &arguments, text) {
            Ok(true) => return Ok(program),
            Ok(false) | Err(_) => tried.push(program),
        }
    }
    Err(format!(
        "no clipboard program worked (tried {})",
        tried.join(", ")
    ))
}

/// The program that opens an address in the browser of the user.
pub fn open_command(os: &str) -> (&'static str, Vec<&'static str>) {
    match os {
        // `start` would read `&` and `^` in an address as shell syntax.
        "windows" => ("rundll32", vec!["url.dll,FileProtocolHandler"]),
        "macos" => ("open", vec![]),
        _ => ("xdg-open", vec![]),
    }
}

/// Opens `url` in the browser. The address is an argument of the opener,
/// which is how each system takes it; the browser gets the part after `#`
/// and does not send it to the server.
pub fn open_in_browser(url: &str) -> Result<(), String> {
    let (program, arguments) = open_command(std::env::consts::OS);
    Command::new(program)
        .args(arguments)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("cannot start {program}: {}", error.kind()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(os: &str, wayland: bool) -> Vec<&'static str> {
        let env = move |name: &str| {
            (wayland && name == "WAYLAND_DISPLAY").then(|| "wayland-0".to_owned())
        };
        clipboard_commands(os, &env)
            .into_iter()
            .map(|(program, _)| program)
            .collect()
    }

    #[test]
    fn clipboard_program_of_each_system() {
        assert_eq!(names("windows", false), ["clip"]);
        assert_eq!(names("macos", false), ["pbcopy"]);
        assert_eq!(names("linux", true), ["wl-copy", "xclip", "xsel"]);
        assert_eq!(names("linux", false), ["xclip", "xsel", "wl-copy"]);
        assert_eq!(names("freebsd", false), ["xclip", "xsel", "wl-copy"]);
    }

    #[test]
    fn opener_of_each_system() {
        assert_eq!(open_command("windows").0, "rundll32");
        assert_eq!(open_command("macos").0, "open");
        assert_eq!(open_command("linux").0, "xdg-open");
    }
}
