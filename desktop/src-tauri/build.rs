fn main() {
    println!("cargo:rerun-if-changed=app.manifest");
    let attributes = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest")),
    );
    tauri_build::try_build(attributes).expect("failed to prepare Eureka desktop resources");
}
