import json,sys,datetime
raw=json.load(open('schools_raw.json'))
diag=json.load(open('diag.json'))
act={k:v for k,v in raw.items() if v['nReports'] or v['amv'] or v['ed'] or v['onSchedule']}
inactive=[dict(code=k,name=v['full'],am=v['am'],py=v['programYear']) for k,v in raw.items() if k not in act]
for v in act.values():
    v.pop('aff',None) if False else None
data=dict(meta=dict(asOf='2026-11-09',evalThrough='2026-10-26',built=datetime.date.today().isoformat(),
   sources=['GST Asset Nov 2026.xls','Area Manager Assets Nov 2026.xls','Ed Team Assets 9.1.26-11.3.26.xls','GST Schedule SY 26_27.xlsx','Missing Assets 26_27.xlsx','Phase-1 roster (cohort.json)']),
   schools=act,inactive=inactive,diag=diag)
js='window.NYSW_DATA='+json.dumps(data,separators=(',',':'),default=str)+';'
open('data.js','w',encoding='utf8').write(js)
print(len(act),'active',len(inactive),'inactive',len(js)//1024,'KB')

open('data.json','w',encoding='utf8').write(json.dumps(data,separators=(',',':'),default=str))
print('also wrote data.json (upload this in the hosted Admin tab)')
