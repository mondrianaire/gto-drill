# GTO+ socket-hang recovery

The GTO+ socket protocol has one known hang reproducer (bkushigian issue
#2, confirmed in v185 REGISTERED by Agent 4):

> Sending `~Take action: N~` where `N` is **greater than or equal to** the
> number of available actions at the current node freezes the dispatcher.

When this happens, GTO+ stays running but `Get-Process GTO | Select
Responding` returns `False`. The GUI does not redraw, the socket accepts
new connections but never replies, and the only fix is to kill the
process via Task Manager and relaunch.

## How to recover

```powershell
# 1. Confirm hang
Get-Process GTO | Format-Table Id, MainWindowTitle, Responding

# 2. Kill hung process
Stop-Process -Name GTO -Force

# 3. Wait 2 seconds for OS to release the socket
Start-Sleep -Seconds 2

# 4. Relaunch GTO+ (path may differ for non-default install)
Start-Process "C:\Program Files\GTO\GTO.exe"

# 5. Verify socket is back up
Test-NetConnection localhost -Port 55143 -InformationLevel Quiet
```

After relaunch, the loaded file state is **lost** — re-`Load file:` whichever
file the workflow needs.

## How to PREVENT the hang

Always send `Request action data` first and parse the action count out of
the reply (count of `[Action:` substrings). Only send `Take action: N` if
`N < count`. The helper `scripts/gto-socket-navigate.mjs` does this
automatically and refuses to send unsafe indices.

A negative index (e.g. `Take action: -1`) returns the harmless error
`~Action does not exist~` — only **positive overshoot** hangs.
