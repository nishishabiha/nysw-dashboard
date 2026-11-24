import pandas as pd, re, warnings, datetime as dt
warnings.filterwarnings('ignore')
D=r"C:\Users\nishi\Downloads\NYSW Dashboard\NYSW 2026.11.03-DataUpload"
CODE=re.compile(r'\b([KMQXRkmqxr]\d{3})\b')
def parse_schedule():
    xl=pd.ExcelFile(D+r"\GST Schedule SY 26_27.xlsx")
    out=[]  # dict(week, gst, code, tags, text, day)
    for sh in xl.sheet_names:
        if sh.lower().startswith('copy'): continue
        df=pd.read_excel(xl,sh,header=None)
        # week monday
        mon=None
        for ci in range(1,min(df.shape[1],7)):
            v=df.iloc[0,ci]
            if isinstance(v,(pd.Timestamp,dt.datetime)):
                mon=(pd.Timestamp(v)-pd.Timedelta(days=ci-1)); break
        if mon is None: continue
        for r in range(1,len(df)):
            gst=df.iloc[r,0]
            if not isinstance(gst,str) or not gst.strip(): continue
            for ci in range(1,min(df.shape[1],7)):
                if ci>5: break
                cell=df.iloc[r,ci]
                if not isinstance(cell,str): continue
                for seg in re.split(r'[\n/]| and ',cell):
                    low=seg.lower()
                    codes=[c.upper() for c in CODE.findall(seg)]
                    if '@' in seg: codes=codes[:1]
                    tags=set()
                    if re.search(r'every other|eow|bi.?weekly',low): tags.add('EOW')
                    if 'monthly' in low: tags.add('Monthly')
                    if re.search(r'\btt\b',low): tags.add('TT')
                    if 'cover' in low: tags.add('cover')
                    if re.search(r'build|osha',low): tags.add('BUILD')
                    for c in codes:
                        out.append(dict(sheet=sh,week=mon.date().isoformat(),gst=gst.strip(),code=c,tags=sorted(tags),day=ci-1,text=seg.strip()))
    return pd.DataFrame(out)
if __name__=='__main__':
    s=parse_schedule(); print(s.shape, s.week.nunique(), s.code.nunique())
    print(s[s.code=='X186'][['week','gst','tags','text']].to_string())
    print(s[s.code=='X228'][['week','gst','tags']].to_string())
    print(s.groupby('week').size())
