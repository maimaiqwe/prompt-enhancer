using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;

internal static class PromptEnhancerWatchdog
{
    private static readonly string[] DefaultAgents =
    {
        "ChatGPT.exe", "codex.exe", "OpenCode.exe", "WorkBuddy.exe",
        "ZCode.exe", "Trae CN.exe", "idea64.exe"
    };

    private static readonly object LogLock = new object();

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint command);

    private const uint GW_OWNER = 4;

    private static string BaseDir
    {
        get { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'); }
    }

    private static string PidPath
    {
        get { return Path.Combine(BaseDir, "enhancer.pid"); }
    }

    private static string LogPath
    {
        get { return Path.Combine(BaseDir, "watchdog.log"); }
    }

    private static void Log(string message)
    {
        lock (LogLock)
        {
            try
            {
                File.AppendAllText(
                    LogPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " | " + message + Environment.NewLine);
            }
            catch { }
        }
    }

    private static string[] LoadAgents(string configPath)
    {
        try
        {
            string text = File.ReadAllText(configPath);
            Match block = Regex.Match(
                text, "\"allowed_processes\"\\s*:\\s*\\[(.*?)\\]",
                RegexOptions.Singleline | RegexOptions.IgnoreCase);
            if (!block.Success) return DefaultAgents;

            MatchCollection items = Regex.Matches(block.Groups[1].Value, "\"([^\"]+)\"");
            if (items.Count == 0) return DefaultAgents;

            string[] names = new string[items.Count];
            for (int i = 0; i < items.Count; i++)
                names[i] = Path.GetFileNameWithoutExtension(items[i].Groups[1].Value.Trim());
            return names;
        }
        catch
        {
            return DefaultAgents;
        }
    }

    private static bool AgentsRunning(string[] names)
    {
        var wanted = new System.Collections.Generic.HashSet<string>(
            StringComparer.OrdinalIgnoreCase);
        foreach (string name in names)
        {
            if (String.IsNullOrEmpty(name)) continue;
            try
            {
                wanted.Add(Path.GetFileNameWithoutExtension(name));
            }
            catch { }
        }
        if (wanted.Count == 0) return false;

        bool found = false;
        try
        {
            EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
            {
                if (!IsWindowVisible(hWnd) || GetWindow(hWnd, GW_OWNER) != IntPtr.Zero)
                    return true;

                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                try
                {
                    using (Process p = Process.GetProcessById((int)pid))
                    {
                        if (wanted.Contains(p.ProcessName))
                        {
                            found = true;
                            return false;
                        }
                    }
                }
                catch { }
                return true;
            }, IntPtr.Zero);
        }
        catch { }
        return found;
    }

    private static int ReadPid()
    {
        try
        {
            if (!File.Exists(PidPath)) return 0;
            int pid;
            return int.TryParse(File.ReadAllText(PidPath).Trim(), out pid) ? pid : 0;
        }
        catch
        {
            return 0;
        }
    }

    private static bool IsEnhancerPid(int pid)
    {
        if (pid <= 0) return false;
        try
        {
            using (Process p = Process.GetProcessById(pid))
            {
                return !p.HasExited &&
                    String.Equals(p.ProcessName, "pythonw", StringComparison.OrdinalIgnoreCase);
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool EnhancerRunning()
    {
        return IsEnhancerPid(ReadPid());
    }

    private static string FindPythonw()
    {
        string candidate = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            @"Programs\Python\Python312\pythonw.exe");
        if (File.Exists(candidate)) return candidate;
        return "pythonw.exe";
    }

    private static bool StartEnhancer()
    {
        string script = Path.Combine(BaseDir, "enhance_hotkey.py");
        if (!File.Exists(script))
        {
            Log("enhancer script not found");
            return false;
        }

        try
        {
            var info = new ProcessStartInfo(FindPythonw(), "\"" + script + "\"");
            info.WorkingDirectory = BaseDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            Process.Start(info);
            return true;
        }
        catch (Exception ex)
        {
            Log("start enhancer failed: " + ex.Message);
            return false;
        }
    }

    private static void RemovePidFile()
    {
        try
        {
            if (File.Exists(PidPath)) File.Delete(PidPath);
        }
        catch { }
    }

    private static void StopEnhancer()
    {
        int pid = ReadPid();
        if (IsEnhancerPid(pid))
        {
            try
            {
                using (Process p = Process.GetProcessById(pid)) p.Kill();
                Log("no agents; enhancer stopped pid=" + pid);
            }
            catch (Exception ex)
            {
                Log("stop enhancer failed: " + ex.Message);
            }
        }
        RemovePidFile();
    }

    private static string ConfigFromArgs(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            if (String.Equals(args[i], "--config", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                return Path.GetFullPath(args[i + 1]);
        }
        return Path.Combine(BaseDir, "config.json");
    }

    private static void Main(string[] args)
    {
        bool created;
        using (var mutex = new Mutex(true, "PromptEnhancerWatchdog", out created))
        {
            if (!created) return;

            string configPath = ConfigFromArgs(args);
            Log("native watchdog started (no WMI); config=" + configPath);
            DateTime? emptySince = null;
            DateTime lastStartAttempt = DateTime.MinValue;

            while (true)
            {
                try
                {
                    string[] agents = LoadAgents(configPath);
                    bool anyAgent = AgentsRunning(agents);
                    bool enhancer = EnhancerRunning();

                    if (anyAgent)
                    {
                        emptySince = null;
                        if (!enhancer && (DateTime.Now - lastStartAttempt).TotalSeconds >= 10)
                        {
                            lastStartAttempt = DateTime.Now;
                            if (StartEnhancer())
                                Log("agent detected; enhancer starting");
                        }
                    }
                    else
                    {
                        if (emptySince == null) emptySince = DateTime.Now;
                        if ((DateTime.Now - emptySince.Value).TotalSeconds >= 8 && enhancer)
                            StopEnhancer();
                        else if (!enhancer)
                            RemovePidFile();
                    }
                }
                catch (Exception ex)
                {
                    Log("watchdog error: " + ex.Message);
                }
                Thread.Sleep(3000);
            }
        }
    }
}
