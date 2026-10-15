from pathlib import Path
root=Path(r'D:\Codex\2026-10-13\pl\work\blank-console-arm64\project\JA21-Silicon-Console\applications\silicon')
file=root/'web/index.html'
html=file.read_text(encoding='utf-8')
start=html.index('<section id="console"')
end=html.index('<section id="russl"',start)
old=html[start:end]
field=old[old.index('<aside class="processor-card">'):old.index('</aside>')+8]
def pane(key,title,kind,slot,button,placeholder):
    attrs=f'data-kind="{kind}"'+(f' data-slot="{slot}"' if slot else '')
    return f'''<section id="pane-{key}" class="terminal-pane terminal-card" {attrs} data-session="disconnected" aria-label="{title} pane">
<div class="pane-heading"><h2>{title}</h2><span class="pane-state">Disconnected</span>{button}<span class="pane-close"></span></div>
<div class="pane-viewport"><div class="pane-placeholder">{placeholder}</div></div>
<form class="pane-command" autocomplete="off"><label class="sr-only" for="input-{key}">{title} command</label><input id="input-{key}" aria-label="{title} command" placeholder="{'Windows PowerShell command' if kind=='admin' else 'Type a command…'}" maxlength="4096" spellcheck="false" disabled><button type="submit" disabled>Run</button><button class="pane-interrupt" type="button" disabled>Stop</button></form>
<div class="pane-footer">{'Windows administrator access · connect explicitly' if kind=='admin' else 'Virtual files · shared XPU'}</div>
<details class="pane-transcript"><summary>Text transcript</summary><pre aria-live="off"></pre></details></section>'''
panes=[pane('xpu-1','XPU 1','xpu',1,'<button id="open-xpu-1" type="button">Connect XPU 1</button>','Waiting for the XPU…'),
pane('xpu-2','XPU 2','xpu',2,'<button id="open-xpu-2" type="button">Connect XPU 2</button>','Waiting for the XPU…'),
pane('admin','Administrator PowerShell','admin',None,'<button id="add-admin-tab" type="button">Connect PowerShell</button>','<strong>Windows administrator terminal</strong><p>Connect to start PowerShell with Windows elevation.</p><p>Delegate to XPU 1 or 2 with <code>Invoke-JA21Terminal</code>.</p>')]
section='''<section id="console" class="view active"><div class="pane-workspace-heading"><div><h1>Three terminals. One workspace.</h1><p>Two virtual XPU terminals and a separate Windows PowerShell connection.</p></div><span id="network-status" class="fine">Private RAM connection</span><button id="reconnect-ws" disabled>Reconnect WebSocket</button></div><div id="terminal-container" class="three-panes">'''+''.join(panes)+'''</div>
<p id="terminal-help" class="fine" hidden>Administrator commands run on Windows. Delegate with <code>Invoke-JA21Terminal -Terminal 1 -Command 'xpu info'</code> or target terminal 2.</p>
<div class="console-state"><span id="session-status">Waiting for worker</span><span id="terminal-boundary">XPU · virtual files and numerical commands</span></div>
<div hidden><div id="tabs" aria-label="Terminal sessions"></div><button id="add-tab">+ XPU</button><button id="add-ws-tab">+ WebSocket</button><form id="command-form"><input id="command" aria-label="Command" maxlength="4096"><button type="submit">Run</button><button id="interrupt" type="button">Interrupt</button></form></div>
<span id="terminal-announcement" class="sr-only" role="status" aria-live="polite"></span>
<details class="field-details"><summary>Field processor and image exports</summary>'''+field+'''</details>
<details class="transcript" hidden><summary>Active terminal transcript</summary><pre id="transcript" aria-live="off"></pre></details></section>
'''
html=html[:start]+section+html[end:]
html=html.replace('8 XPU terminals + 1 administrator terminal · local connections','2 XPU panes + Administrator PowerShell · local connections')
file.write_text(html,encoding='utf-8',newline='\n')
app=root/'src/app.js'
js=app.read_text(encoding='utf-8')
js=js.replace("$('command').focus();}catch(error)","active?.input?.focus();}catch(error)")
js=js.replace("selectXpu();$('command').value=c.name;view('console');$('command').focus();","selectXpu();active.input.value=c.name;view('console');active.input.focus();")
js=js.replace("if(!active?.socket || statusBusy || document.hidden)return;","if(!active?.socket || active.closed || active.removed || statusBusy || document.hidden)return;")
app.write_text(js,encoding='utf-8',newline='\n')
