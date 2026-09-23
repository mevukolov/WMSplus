# send-raw.ps1 -- sends a file's raw bytes to a locally installed Windows
# printer (USB, LPT, or network share, doesn't matter -- this bypasses
# whatever driver is attached and writes bytes as-is via the RAW datatype).
# Standard winspool.drv passthrough pattern (OpenPrinter/StartDocPrinter/
# WritePrinter), used here because index.js has no native Node module for
# USB/spooler printing and this needs no Visual Studio Build Tools to run.
#
# Usage: powershell -ExecutionPolicy Bypass -File send-raw.ps1 -PrinterName "TSC DA220" -FilePath "C:\path\to\job.bin"
# Exit code 0 = success, 1 = failure (message on stderr).

param(
    [Parameter(Mandatory=$true)][string]$PrinterName,
    [Parameter(Mandatory=$true)][string]$FilePath
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string printerName, byte[] bytes, out string error)
    {
        error = null;
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "WMS+ TSPL job";
        di.pDataType = "RAW";

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
        {
            error = "OpenPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ") -- check PRINTER_NAME matches Windows exactly";
            return false;
        }
        try
        {
            if (!StartDocPrinter(hPrinter, 1, di))
            {
                error = "StartDocPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")";
                return false;
            }
            try
            {
                if (!StartPagePrinter(hPrinter))
                {
                    error = "StartPagePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")";
                    return false;
                }
                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int written;
                    bool ok = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
                    int writeError = Marshal.GetLastWin32Error(); // capture before EndPagePrinter can overwrite it
                    EndPagePrinter(hPrinter);
                    if (!ok || written != bytes.Length)
                    {
                        error = "WritePrinter wrote " + written + " of " + bytes.Length + " bytes (Win32 error " + writeError + ")";
                        return false;
                    }
                    return true;
                }
                finally
                {
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                }
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$errorMessage = $null
$ok = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes, [ref]$errorMessage)

if ($ok) {
    Write-Output "OK"
    exit 0
} else {
    [Console]::Error.WriteLine($errorMessage)
    exit 1
}
