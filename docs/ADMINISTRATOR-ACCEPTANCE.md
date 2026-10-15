# Administrator PowerShell acceptance — console 1.4.0

At packaging, actual UAC startup remains **NOT_RUN**. Native pipe diagnostics in the Codex tool environment returned Windows access denied. These checks complete those gates in an ordinary Windows desktop session; browser and controlled protocol tests alone do not prove them.

Administrator PowerShell runs Windows programs and can read or change laptop files. `Invoke-JA21Terminal` sends a command to the chosen existing XPU terminal. XPU 1 and XPU 2 continue to use the virtual volume.

## Open the release

1. Check the release ZIP against its supplied SHA256 file. Extract to a separate short folder under `D:\Codex`, such as `D:\Codex\JA21-1.4.0`. Keep the previous package, workspace and exported backups.
2. In File Explorer, open the extracted package and double-click **Start Console.cmd**. Use the ordinary Windows session. Wait for the **XPU 1** and **XPU 2** prompts. If startup fails, record the exact message and retain `workspace/logs/boot-latest.log`.
3. Click **Connect PowerShell** in the **Administrator PowerShell** pane. Complete the Windows consent request for the packaged `JA21-Admin-Terminal.exe` if it appears. Record whether consent was requested, granted, cancelled or unnecessary because the caller was already elevated.
4. At the Administrator prompt, run the following. Its output must be `True`.

~~~powershell
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
~~~

## Prove both delegation paths

These commands create two uniquely named temporary **virtual** files with known contents. They leave existing files untouched. Keep XPU 1 and XPU 2 idle with empty command lines before starting. Paste one code block at a time into the Administrator command box and press Enter.

Create the test paths and result record. The last two output lines print the paths for the independent reads below.

~~~powershell
$auditId=[Guid]::NewGuid().ToString('N');$path1='/tmp/ja21-admin-'+$auditId+'-t1.txt';$path2='/tmp/ja21-admin-'+$auditId+'-t2.txt';$proof=[ordered]@{utc=[DateTime]::UtcNow.ToString('o');powerShellPid=$PID;administrator=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);path1=$path1;path2=$path2};$path1;$path2
~~~

Write `21` through XPU 1 and read that file through XPU 2:

~~~powershell
$proof['write1']=Invoke-JA21Terminal -Terminal 1 -Command ('echo 21 > '+$path1);$proof['read1Via2']=Invoke-JA21Terminal -Terminal 2 -Command ('cat '+$path1);$proof['read1Via2']|ConvertTo-Json -Depth 6
~~~

Write `42` through XPU 2 and read that file through XPU 1:

~~~powershell
$proof['write2']=Invoke-JA21Terminal -Terminal 2 -Command ('echo 42 > '+$path2);$proof['read2Via1']=Invoke-JA21Terminal -Terminal 1 -Command ('cat '+$path2);$proof['read2Via1']|ConvertTo-Json -Depth 6
~~~

Independently use the **XPU 2** pane: enter `cat ` followed by the printed `path1`; it must print `21`. In **XPU 1**, enter `cat ` followed by `path2`; it must print `42`. Capture these reads or record their exact output. This checks the two existing sessions directly, as well as the returned Administrator results.

Return to Administrator PowerShell. Request information from both terminals, then an unsaved GPU preview:

~~~powershell
$proof['info1']=Invoke-JA21Terminal -Terminal 1 -Command 'xpu info';$proof['info2']=Invoke-JA21Terminal -Terminal 2 -Command 'xpu info';$proof['gpuPreview']=Invoke-JA21Terminal -Terminal 2 -Command 'xpu run add 1 2 8 4 gpu field';$proof|ConvertTo-Json -Depth 8
~~~

Each successful delegated result must show `code: 0`, `completion: COMPLETED` and `truncated: false`. The GPU result must explicitly confirm actual GPU execution and matching readback. Record a refusal, timeout or `UNKNOWN` as such; a prompt or input acknowledgement is not completed execution. Leave the preview unsaved.

Remove only the two virtual files created above, then copy the final JSON result:

~~~powershell
$proof['cleanup1']=Invoke-JA21Terminal -Terminal 1 -Command ('rm '+$path1);$proof['cleanup2']=Invoke-JA21Terminal -Terminal 2 -Command ('rm '+$path2);$proof|ConvertTo-Json -Depth 8
~~~

## Check closing, reopening and cancellation

1. Note `powerShellPid` from the JSON and close the Administrator connection with its close control. In a separate ordinary Windows PowerShell window, run `Get-Process -Id <recorded PID> -ErrorAction SilentlyContinue`, replacing the placeholder with that PID. No returned process confirms the owned PowerShell exited.
2. Reopen Administrator PowerShell, record its new `$PID`, check the Administrator Boolean again and delegate `xpu info` to terminals 1 and 2. Both original XPU panes must still respond.
3. Close it again. Open Administrator PowerShell once more and cancel the Windows consent request. Confirm that no connected Administrator terminal remains and XPU 1 and XPU 2 still accept commands. If Windows does not request consent in the current elevated session, mark this consent-cancellation check **NOT_RUN**.

## Share the result

Share the release ZIP hash, final `$proof` JSON, independent `21`/`42` read results, owned-PID closure result, reopening/cancellation observations and any exact error text. A screenshot of the three connected panes is useful. Include the boot log if startup failed. Do not send browser profiles, full workspace archives, credentials or unrelated laptop files. Mark unperformed checks **NOT_RUN**.
