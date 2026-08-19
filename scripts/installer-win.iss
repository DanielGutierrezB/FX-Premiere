; FX Premiere installer for Windows (Inno Setup 6).
; Build with: iscc /DAppVersion=1.2.3 scripts\installer-win.iss
; Expects dist\ to already contain the built extension and helper\win\fxp-hotkey.exe.

#define AppName "FX Premiere"
#define BundleId "com.fxpremiere.suite"

; The version comes from package.json through the command line. Guessing it here once shipped an
; installer stamped with the previous release, so an unstamped build now refuses to be made.
#ifndef AppVersion
  #error Pass the version: iscc /DAppVersion=$(node -p "require('./package.json').version") scripts\installer-win.iss
#endif

[Setup]
AppId={{9C4A1F2E-6F3B-4E2A-9C67-FX0PREMIERE01}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=FX Premiere
; Per user, not into Common Files. The panel updates itself by unpacking a release over the folder
; it runs from, and a folder under Program Files needs administrator rights to write, so an editor
; who installed there could never take an update from the settings. Premiere reads the per-user CEP
; folder too, and installing there needs no elevation at all.
DefaultDirName={userappdata}\Adobe\CEP\extensions\{#BundleId}
DisableDirPage=yes
DisableProgramGroupPage=yes
UninstallDisplayName={#AppName}
OutputDir=..\release
OutputBaseFilename=FX-Premiere-{#AppVersion}-setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
; A machine that got an earlier release has the old Common Files path recorded against this AppId,
; and Inno would happily reuse it and reinstall somewhere unwritable.
UsePreviousAppDir=no
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Files]
Source: "..\dist\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\dist\helper\win\fxp-hotkey.exe"; DestDir: "{app}\helper\win"; Flags: ignoreversion

[InstallDelete]
Type: files; Name: "{app}\.debug"
; The copy that releases up to 1.6.2 put in Common Files is deliberately not deleted here. It sits
; outside the per-user area this installer is allowed to touch, and deleting it needs the rights
; this installer no longer asks for. Anyone upgrading from one of those releases should uninstall
; FX Premiere from Windows Settings first, or Premiere will list the panel twice; the README says so.

[Registry]
; Unsigned extensions require CEP debug mode.
Root: HKCU; Subkey: "Software\Adobe\CSXS.9"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.13"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

[Messages]
FinishedLabel=FX Premiere is installed. Start Premiere Pro and press Ctrl+Space, or open Window > Extensions > FX Premiere.

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
