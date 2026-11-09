Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public struct RECT { public int L, T, R, B; }
}
"@
$found = @()
$cb = [W+EnumWindowsProc]{
  param($h, $l)
  $r = New-Object W+RECT
  [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.R - $r.L; $ht = $r.B - $r.T
  if ($w -eq 340 -and $ht -eq 320) {
    $ex = [W]::GetWindowLong($h, -20)
    $sb = New-Object System.Text.StringBuilder 256
    [W]::GetWindowText($h, $sb, 256) | Out-Null
    $script:found += [pscustomobject]@{
      Handle=$h; Rect="$($r.L),$($r.T) ${w}x${ht}"; Visible=[W]::IsWindowVisible($h);
      TopMost = [bool]($ex -band 0x8); ToolWindow = [bool]($ex -band 0x80);
      Layered = [bool]($ex -band 0x80000); Title=$sb.ToString()
    }
  }
  return $true
}
[W]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
if ($found.Count -eq 0) { "NO 340x320 WINDOW FOUND" } else { $found | Format-List }
"foreground hwnd: " + [W]::GetForegroundWindow()
