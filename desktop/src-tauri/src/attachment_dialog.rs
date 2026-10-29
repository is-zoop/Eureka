#[cfg(windows)]
mod platform {
    use std::sync::{Arc, Mutex};
    use windows::{
        core::{implement, w, Interface, Ref, Result, BOOL, HSTRING, HRESULT},
        Win32::{
            Foundation::{HWND, ERROR_CANCELLED, S_OK},
            System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED},
            UI::Shell::*,
        },
    };

    const ADD_FOLDER: u32 = 1001;

    unsafe fn item_path(item: &IShellItem) -> Result<String> {
        let value = item.GetDisplayName(SIGDN_FILESYSPATH)?;
        let path = value.to_string();
        CoTaskMemFree(Some(value.0.cast()));
        Ok(path?)
    }

    #[implement(IFileDialogEvents, IFileDialogControlEvents)]
    struct FolderButton { selected: Arc<Mutex<Option<String>>> }

    #[allow(non_snake_case)]
    impl IFileDialogEvents_Impl for FolderButton_Impl {
        fn OnFileOk(&self, _: Ref<'_, IFileDialog>) -> Result<()> { Ok(()) }
        fn OnFolderChanging(&self, _: Ref<'_, IFileDialog>, _: Ref<'_, IShellItem>) -> Result<()> { Ok(()) }
        fn OnFolderChange(&self, _: Ref<'_, IFileDialog>) -> Result<()> { Ok(()) }
        fn OnSelectionChange(&self, _: Ref<'_, IFileDialog>) -> Result<()> { Ok(()) }
        fn OnShareViolation(&self, _: Ref<'_, IFileDialog>, _: Ref<'_, IShellItem>) -> Result<FDE_SHAREVIOLATION_RESPONSE> { Ok(FDESVR_DEFAULT) }
        fn OnTypeChange(&self, _: Ref<'_, IFileDialog>) -> Result<()> { Ok(()) }
        fn OnOverwrite(&self, _: Ref<'_, IFileDialog>, _: Ref<'_, IShellItem>) -> Result<FDE_OVERWRITE_RESPONSE> { Ok(FDEOR_DEFAULT) }
    }

    #[allow(non_snake_case)]
    impl IFileDialogControlEvents_Impl for FolderButton_Impl {
        fn OnItemSelected(&self, _: Ref<'_, IFileDialogCustomize>, _: u32, _: u32) -> Result<()> { Ok(()) }
        fn OnButtonClicked(&self, customize: Ref<'_, IFileDialogCustomize>, id: u32) -> Result<()> {
            if id == ADD_FOLDER {
                unsafe {
                    let dialog: IFileDialog = customize.as_ref().unwrap().cast()?;
                    *self.selected.lock().unwrap() = Some(item_path(&dialog.GetFolder()?)?);
                    dialog.Close(S_OK)?;
                }
            }
            Ok(())
        }
        fn OnCheckButtonToggled(&self, _: Ref<'_, IFileDialogCustomize>, _: u32, _: BOOL) -> Result<()> { Ok(()) }
        fn OnControlActivating(&self, _: Ref<'_, IFileDialogCustomize>, _: u32) -> Result<()> { Ok(()) }
    }

    pub fn open(owner: usize, cwd: Option<String>) -> std::result::Result<Vec<String>, String> {
        unsafe { show(owner, cwd, false).map_err(|error| error.to_string()) }
    }

    pub fn open_directory(owner: usize, cwd: Option<String>) -> std::result::Result<Option<String>, String> {
        unsafe { show(owner, cwd, true).map(|paths| paths.into_iter().next()).map_err(|error| error.to_string()) }
    }

    unsafe fn show(owner: usize, cwd: Option<String>, directory_only: bool) -> Result<Vec<String>> {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        struct Apartment;
        impl Drop for Apartment { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
        let _apartment = Apartment;
        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
        let options = dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR;
        dialog.SetOptions(options | if directory_only { FOS_PICKFOLDERS } else { FOS_ALLOWMULTISELECT | FOS_FILEMUSTEXIST })?;
        if let Some(directory) = cwd.filter(|value| !value.is_empty()) {
            let folder: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(directory), None)?;
            // SetFolder overrides Windows' remembered directory on every opening.
            dialog.SetFolder(&folder)?;
        }
        if !directory_only {
            let customize: IFileDialogCustomize = dialog.cast()?;
            customize.AddPushButton(ADD_FOLDER, w!("添加当前文件夹"))?;
        }
        let selected = Arc::new(Mutex::new(None));
        let events: IFileDialogEvents = FolderButton { selected: selected.clone() }.into();
        let cookie = dialog.Advise(&events)?;
        let shown = dialog.Show(Some(HWND(owner as *mut _)));
        dialog.Unadvise(cookie)?;
        if let Err(error) = shown {
            if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) { return Ok(Vec::new()); }
            return Err(error);
        }
        if let Some(folder) = selected.lock().unwrap().take() { return Ok(vec![folder]); }
        let items = dialog.GetResults()?;
        let mut paths = Vec::new();
        for index in 0..items.GetCount()? { paths.push(item_path(&items.GetItemAt(index)?)?); }
        Ok(paths)
    }
}

#[cfg(windows)]
pub use platform::{open, open_directory};

#[cfg(not(windows))]
pub fn open(_: usize, _: Option<String>) -> Result<Vec<String>, String> {
    Err("Native attachment selection is supported on Windows.".into())
}

#[cfg(not(windows))]
pub fn open_directory(_: usize, _: Option<String>) -> Result<Option<String>, String> {
    Err("Native directory selection is supported on Windows.".into())
}
