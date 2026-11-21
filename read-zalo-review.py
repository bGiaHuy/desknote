"""Read the existing Zalo listener's cache without a second login/session."""
import json
import os
from pathlib import Path
import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')
data_dir=Path(os.environ.get('DESKNOTE_DATA_DIR') or (Path(os.environ['APPDATA'])/('Huy'+' Desk') if (Path(os.environ['APPDATA'])/('Huy'+' Desk')/'tasknest.json').exists() else Path(os.environ['APPDATA'])/'Desknote'))
config_path=data_dir/'inbox-local.json'
config=json.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
excluded=tuple(config.get('excludedZaloThreads',[]))
account=config.get('zaloAccount','')
since,until,limit=map(int,sys.argv[1:4])
if since<0 or until<since or until-since>7*86400000 or not 1<=limit<=1000:
    raise ValueError('Invalid review window.')
db=Path(os.environ['DESKNOTE_ZALO_DB']) if os.environ.get('DESKNOTE_ZALO_DB') else Path.home()/'.zalo-agent-cli'/'accounts'/account/'zalo.db'
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True,timeout=8)
c.row_factory=sqlite3.Row
# Exclusions are applied by SQLite BEFORE message text leaves the database.
rows=c.execute('''SELECT m.msgId,m.threadId,m.senderId,m.senderName,m.text,m.timestamp,m.has_attachment,t.name threadName
 FROM messages m LEFT JOIN threads t ON t.threadId=m.threadId
 WHERE m.timestamp>? AND m.timestamp<=? AND m.threadId NOT IN (SELECT value FROM json_each(?))
 ORDER BY m.timestamp,m.msgId LIMIT ?''',(since,until,json.dumps(excluded),limit+1)).fetchall()
truncated=len(rows)>limit
rows=rows[:limit]
messages=[{'source':'zalo','id':r['msgId'],'threadId':r['threadId'],'threadName':r['threadName'] or '',
 'sender':r['senderName'] or '', 'isSelf':r['senderId']==account,'timestamp':r['timestamp'],
 'text':r['text'] or '', 'hasAttachment':bool(r['has_attachment'])} for r in rows]
sync=dict(c.execute('SELECT key,value FROM sync_state'))
connected=sync.get('lastConnectionOk')=='true'
print(json.dumps({'source':'zalo','messages':messages,'connected':connected,'truncated':truncated,
 'throughMs':(rows[-1]['timestamp']-1 if truncated and rows else until) if connected else since,
 'excludedThreads':list(excluded),'coverage':'Tin đã được listener Zalo đồng bộ; không mở phiên đăng nhập mới.'},ensure_ascii=False))
