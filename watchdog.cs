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
        "ChatGPT.exe", "codex.exe", "claude.exe", "Cursor.exe",
        "gemini.exe", "OpenCode.exe", "Windsurf.exe", "QoderCN.exe",
        "CodeBuddy.exe", "WorkBuddy.exe", "WorkBuddyAI.exe",
        "ZCode.exe", "Trae CN.exe", "codex-app-manager.exe", "idea64.exe"
    };

    private static readonly object LogLock = new object();
    private static string[] CachedAgents;
    private static DateTime LastConfigWriteUtc = DateTime.MinValue;

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
            if (File.GetLastWriteTimeUtc(configPath) == LastConfigWriteUtc &&
                CachedAgents != null)
                return CachedAgents;
            Match block = Regex.Match(
                text, "\"allowed_processes\"\\s*:\\s*\\[(.*?)\\]",
                RegexOptions.Singleline | RegexOptions.IgnoreCase);
            if (!block.Success) return DefaultAgents;
            MatchCollection items = Regex.Matches(block.Groups[1].Value, "\"([^\"]+)\"");
            if (items.Count == 0) return DefaultAgents;
            var names = new System.Collections.Generic.List<string>();
            foreach (Match item in items)
            {
                string value = item.Groups[1].Value.Trim();
                if (String.IsNullOrWhiteSpace(value)) continue;
                names.Add(Path.GetFileNameWithoutExtension(value));
            }
            string[] agents = names.Count == 0 ? DefaultAgents : names.ToArray();
            CachedAgents = agents;
            LastConfigWriteUtc = File.GetLastWriteTimeUtc(configPath);
            return agents;
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

    private sealed class PidState
    {
        public int Pid;
        public string StartedAt = "";
        public string ScriptPath = "";
    }

    private static PidState ReadPidState()
    {
        try
        {
            if (!File.Exists(PidPath)) return null;
            string raw = File.ReadAllText(PidPath).Trim();
            if (raw.StartsWith("{"))
            {
                var state = new PidState();
                Match pidMatch = Regex.Match(raw, "\"pid\"\\s*:\\s*(\\d+)");
                Match startedMatch = Regex.Match(
                    raw, "\"started_at\"\\s*:\\s*\"([^\"]*)\"");
                Match scriptMatch = Regex.Match(
                    raw,
                    "\"script_path\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
                if (!pidMatch.Success || !int.TryParse(pidMatch.Groups[1].Value, out state.Pid))
                    return null;
                if (startedMatch.Success) state.StartedAt = startedMatch.Groups[1].Value;
                if (scriptMatch.Success)
                    state.ScriptPath = Regex.Unescape(scriptMatch.Groups[1].Value);
                return state;
            }
            int legacyPid;
            if (int.TryParse(raw, out legacyPid))
                return new PidState { Pid = legacyPid };
            return null;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsEnhancerPid(PidState state)
    {
        if (state == null || state.Pid <= 0) return false;
        try
        {
            using (Process p = Process.GetProcessById(state.Pid))
            {
                if (p.HasExited ||
                    !String.Equals(p.ProcessName, "pythonw", StringComparison.OrdinalIgnoreCase))
                    return false;
                if (!String.IsNullOrWhiteSpace(state.ScriptPath))
                {
                    string expected = Path.GetFullPath(
                        Path.Combine(BaseDir, "enhance_hotkey.py"));
                    if (!String.Equals(
                        Path.GetFullPath(state.ScriptPath),
                        expected,
                        StringComparison.OrdinalIgnoreCase))
                        return false;
                }
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool EnhancerRunning()
    {
        return FindEnhancerPids().Count > 0;
    }

    private static System.Collections.Generic.List<int> FindEnhancerPids()
    {
        var result = new System.Collections.Generic.List<int>();
        string expected = Path.GetFullPath(Path.Combine(BaseDir, "enhance_hotkey.py"));
        foreach (Process p in Process.GetProcessesByName("pythonw"))
        {
            try
            {
                if (p.HasExited) continue;
                string commandLine = ReadCommandLine(p.Id);
                if (commandLine.IndexOf(
                    expected, StringComparison.OrdinalIgnoreCase) >= 0)
                    result.Add(p.Id);
            }
            catch { }
            finally { p.Dispose(); }
        }
        return result;
    }

    private static string ReadCommandLine(int pid)
    {
        try
        {
            using (var searcher = new System.Management.ManagementObjectSearcher(
                "SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + pid))
            using (var results = searcher.Get())
            {
                foreach (System.Management.ManagementObject item in results)
                {
                    object value = item["CommandLine"];
                    return value == null ? "" : value.ToString();
                }
            }
        }
        catch { }
        return "";
    }

    private static string FindPythonw()
    {
        string configured = Environment.GetEnvironmentVariable("PROMPT_ENHANCER_PYTHONW");
        if (!String.IsNullOrWhiteSpace(configured) && File.Exists(configured))
            return configured;

        string pointerPath = Path.Combine(BaseDir, "pythonw.path");
        try
        {
            if (File.Exists(pointerPath))
            {
                string pointed = File.ReadAllText(pointerPath).Trim();
                if (!String.IsNullOrWhiteSpace(pointed) && File.Exists(pointed))
                    return pointed;
            }
        }
        catch { }

        string[] candidates =
        {
            Path.Combine(BaseDir, "pythonw.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Programs\Python\Python312\pythonw.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Programs\Python\Python311\pythonw.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Programs\Python\Python310\pythonw.exe"),
        };
        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate)) return candidate;
        }

        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string directory in path.Split(Path.PathSeparator))
        {
            try
            {
                string candidate = Path.Combine(directory.Trim(), "pythonw.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch { }
        }

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
        var pids = FindEnhancerPids();
        foreach (int pid in pids)
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
