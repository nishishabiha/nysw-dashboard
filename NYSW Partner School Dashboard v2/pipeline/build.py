import pandas as pd, re, json, warnings, datetime as dt, collections, math
warnings.filterwarnings('ignore')
import gstsched as sc
from gstsched import parse_schedule, D

CODE_RE = re.compile(r'^([KMQXR]\d{3})\b')


KEYMAP = {}


def key_of(name):
    nm = str(name).strip()
    m = CODE_RE.match(nm)
    if m:
        return m.group(1)
    return KEYMAP.get(nm, nm)


def clean(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).strip()
    return s or None


def pdate(v):
    t = pd.to_datetime(v, errors='coerce')
    return None if pd.isna(t) else t.normalize()


def title_date(t):
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{2,4})', str(t))
    if not m:
        return None
    mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    y = y + 2000 if y < 100 else y
    try:
        return pd.Timestamp(y, mo, d)
    except Exception:
        return None


def monday(t):
    return (t - pd.Timedelta(days=t.weekday())).normalize()


def iso(t):
    return None if t is None or pd.isna(t) else t.date().isoformat()


def first(s):
    s = clean(s)
    return s.split()[0] if s else None



DROP={'al','nj','wy','na','n','a','as','nmu','ny'}
def norm_name(n):
    n=re.sub(r'\(.*?\)','',str(n)).lower()
    toks=[t for t in re.sub(r'[^a-z0-9 ]',' ',n).split()]
    while toks and (toks[0] in DROP or (len(toks[0])>=4 and toks[0]==toks[0].upper() and False)): toks=toks[1:]
    return ' '.join(toks)
_all_raw=set()
g = pd.read_excel(D + r"\GST Asset Nov 2026.xls")
a = pd.read_excel(D + r"\Area Manager Assets Nov 2026.xls")
e = pd.read_excel(D + r"\Ed Team Assets 9.1.26-11.3.26.xls")
cohort = {s['school']['dbn']: s for s in json.load(open('repo/data/cohort.json'))['schools']}
cohort_by_name = {v['school']['name'].lower(): k for k, v in cohort.items()}
COH_RAW=dict(cohort)
diag = collections.OrderedDict()
def build_keymap():
    pri=[]
    for df in (g,a,e):
        for n in df.Against.dropna().unique(): pri.append(str(n).strip())
    secondary=[v['school']['name'] for v in cohort.values()]
    # code-less canonical names come from asset data first
    canon=[]
    for n in pri:
        if CODE_RE.match(n): continue
        nn=norm_name(n)
        hit=None
        for c in canon:
            cn=norm_name(c)
            if cn==nn or (len(min(cn,nn,key=len))>=8 and (cn in nn or nn in cn)): hit=c;break
        if hit: KEYMAP[n]=hit
        else: canon.append(n)
    return canon
CANON=build_keymap()
# cohort codeless entries: map by name to canon
_new={}
for k,v in cohort.items():
    if CODE_RE.match(k+' '): _new[k]=v; continue
    nn=norm_name(v['school']['name']); hit=None
    for c in CANON:
        cn=norm_name(c)
        if cn==nn or (len(min(cn,nn,key=len))>=8 and (cn in nn or nn in cn)): hit=c;break
    _new[hit or v['school']['name']]=v
cohort=_new
cohort_by_name={}


# ---------- GST ----------
g['vd'] = g['Visit date'].map(pdate)
g['td'] = g['Title'].map(title_date)
diag['gst_rows'] = len(g)
diag['gst_missing_visit_date'] = int(g.vd.isna().sum())
g['vd_src'] = g.vd.isna().map({True: 'title', False: 'field'})
g['vd'] = g.vd.fillna(g.td)
diag['gst_unrecoverable_date'] = int(g.vd.isna().sum())
g = g[g.vd.notna()].copy()
g['key'] = g.Against.map(key_of)
g['_nn'] = g.notna().sum(axis=1)
g = g.sort_values(['key', 'vd', '_nn'], ascending=[True, True, False])
dups = g.duplicated(['key', 'vd'], keep='first')
diag['gst_duplicate_school_days'] = int(dups.sum())
gd = g[~dups].copy()
diag['gst_after_nov6'] = int((gd.vd > pd.Timestamp('2026-11-06')).sum())
wk = gd.groupby(gd.vd.map(monday)).size()
diag['gst_weekly_counts'] = {iso(k): int(v) for k, v in wk.items()}

# ---------- schedule ----------
S = parse_schedule()
S = S[~S.tags.map(lambda t: 'BUILD' in t)].copy()
S['key'] = S.code
alias = {'bnos malka': 'Bnos Malka', 'lincoln': 'Lincoln High School (Yonkers', 'roaring brook': 'Roaring Brook',
         'greeley': 'Horace Greeley', 'bell': 'Robert E Bell', 'westorchard': 'Westorchard',
         'seven bridges': 'Seven Bridges', 'astoria houses': 'Astoria Houses'}
name_keys = {}
for n in g.Against.unique():
    for al, frag in alias.items():
        if frag.lower() in n.lower():
            name_keys[al] = n.strip()
xl = pd.ExcelFile(D + r"\GST Schedule SY 26_27.xlsx")
named = []
for sh in xl.sheet_names:
    if sh.lower().startswith('copy'):
        continue
    df = pd.read_excel(xl, sh, header=None)
    mon = None
    for ci in range(1, 6):
        v = df.iloc[0, ci]
        if isinstance(v, (pd.Timestamp, dt.datetime)):
            mon = pd.Timestamp(v) - pd.Timedelta(days=ci - 1)
            break
    if mon is None:
        continue
    for r in range(1, len(df)):
        gname = df.iloc[r, 0]
        if not isinstance(gname, str):
            continue
        for ci in range(1, 6):
            cell = df.iloc[r, ci]
            if isinstance(cell, str):
                low = cell.lower()
                for al, nm in name_keys.items():
                    if re.search(r'\b' + re.escape(al) + r'\b', low):
                        eow = bool(re.search('every other|eow', low))
                        named.append(dict(week=mon.date().isoformat(), gst=gname.strip(), code=nm,
                                          tags=['EOW'] if eow else [], day=ci - 1, text=cell, key=nm))
if named:
    S = pd.concat([S, pd.DataFrame(named)], ignore_index=True)
S['key'] = S['key'].map(key_of)
S = S.drop_duplicates(['key', 'week'])
cad = {}
for k, grp in S.groupby('key'):
    tg = [t for ts in grp.tags for t in ts]
    cad[k] = 'EOW' if 'EOW' in tg else ('Monthly' if 'Monthly' in tg else 'Weekly')
tt_weeks = S[S.tags.map(lambda t: 'TT' in t)].groupby('key').week.apply(list).to_dict()
sched_keys = set(S.key)
diag['schedule_weeks'] = int(S.week.nunique())
diag['schedule_unique_schools'] = int(S.key.nunique())
known = set(g.key) | set(a.Against.map(key_of)) | set(e.Against.map(key_of)) | set(cohort)
diag['schedule_codes_without_any_asset_or_roster'] = sorted(k for k in sched_keys if k not in known)

# ---------- universe ----------
names = {}
for df in (g, a, e):
    for n in df.Against.dropna().unique():
        names.setdefault(key_of(n), n.strip())
for k, v in cohort.items():
    names.setdefault(k, f"{k} {v['school']['name']}")
universe = set(g.key) | set(a.Against.map(key_of)) | set(e.Against.map(key_of)) | set(cohort)
LAST_FULL_WEEK = pd.Timestamp('2026-10-26')
WEEKS = sorted(pd.to_datetime(S.week.unique()))


def num_rating(v):
    m = re.match(r'\s*(\d)', str(v))
    return int(m.group(1)) if m else None


def weight_lbs(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None, False
    s = str(v).lower().replace(',', '')
    m = re.search(r'(\d+(?:\.\d+)?)\s*(oz|ounce|ounces|gr|g|gram|grams|lb|lbs|pound|pounds|kg)?', s)
    if not m:
        return None, True
    n = float(m.group(1))
    u = m.group(2)
    if u in ('oz', 'ounce', 'ounces'):
        return round(n / 16, 2), False
    if u in ('gr', 'g', 'gram', 'grams'):
        return round(n / 453.6, 2), False
    if u == 'kg':
        return round(n * 2.2046, 2), False
    if u in ('lb', 'lbs', 'pound', 'pounds'):
        return n, False
    return n, True


def snip(s, n=240):
    s = clean(s)
    if not s:
        return None
    s = re.sub(r'\s+', ' ', s)
    return s if len(s) <= n else s[:n - 1] + '…'


schools = {}
for k in sorted(universe):
    nm = names[k]
    gs = gd[gd.key == k].sort_values('vd')
    am_ = a[a.Against.map(key_of) == k].copy()
    es = e[e.Against.map(key_of) == k].copy()
    co = cohort.get(k) or cohort.get(cohort_by_name.get(re.sub(r'^[KMQXR]\d{3}\s+', '', nm).lower(), ''))
    c = co['school'] if co else {}
    ams = ([first(x) for x in gs['99.1 Area Manager'].dropna()] + [first(x) for x in am_['99.1 Area Manager'].dropna()]
           + [first(x) for x in es['99.1 Area Manager'].dropna()])
    ams = [x for x in ams if x]
    p1 = c.get('areaManager') if c.get('areaManager') not in (None, 'Unassigned') else None
    am = collections.Counter(ams).most_common(1)[0][0] if ams else p1
    amsrc = 'assets' if ams else ('phase1 roster' if am else None)
    gl = [x for x in gs['GST Member reporting information'].dropna()]
    gcount = collections.Counter(gl)
    gst = gcount.most_common(1)[0][0] if gl else c.get('assignedGst')
    meta = gs.iloc[-1] if len(gs) else (am_.iloc[-1] if len(am_) else (es.iloc[-1] if len(es) else None))

    def mv(col):
        if meta is None:
            return None
        return clean(meta.get(col))

    visit_day = collections.Counter(gs.vd.dt.day_name()).most_common(1)[0][0] if len(gs) else None
    schedW = set(S[S.key == k].week)
    doneW = collections.Counter(gs.vd.map(lambda t: iso(monday(t))))
    weeks = []
    for w in WEEKS:
        if w > LAST_FULL_WEEK:
            continue
        wi = iso(w)
        weeks.append(dict(w=wi, s=int(wi in schedW), d=int(doneW.get(wi, 0))))
    reps = []
    for _, r in gs.iterrows():
        off = clean(r['Select Systems not running ( if any)'])
        reps.append(dict(d=iso(r.vd), off=[x.strip() for x in off.split(',')] if off else [],
                         leak=bool(clean(r['Select systems with leaks'])), pest=clean(r['Issues with Pests?']),
                         seed=clean(r['Are seedlings planted?']), conv=clean(r['In-person conversation w/ teacher about HC?']),
                         nh=clean(r['Next Harvest Date (Estimate)']), note=snip(r['General Notes'], 260),
                         gst=first(r['GST Member reporting information'])))
    def streak(flags):
        n = 0
        for f in reversed(flags):
            if f:
                n += 1
            else:
                break
        return n
    sysnames = sorted({s_ for r_ in reps for s_ in r_['off']})
    nh_dates = []
    for r_ in reps:
        t_ = pd.to_datetime(r_['nh'], errors='coerce') if r_['nh'] else None
        if t_ is not None and not pd.isna(t_):
            nh_dates.append((r_['d'], iso(t_)))
    agg = dict(n=len(reps), offN=sum(1 for r_ in reps if r_['off']), leakN=sum(1 for r_ in reps if r_['leak']),
               pestN=sum(1 for r_ in reps if r_['pest']), seedYes=sum(1 for r_ in reps if r_['seed'] == 'Yes'),
               seedNo=sum(1 for r_ in reps if r_['seed'] == 'No'),
               convYes=sum(1 for r_ in reps if r_['conv'] == 'Yes'),
               convPhone=sum(1 for r_ in reps if r_['conv'] and r_['conv'].startswith('Spoke')),
               convNo=sum(1 for r_ in reps if r_['conv'] == 'No'),
               offStreaks={s_: streak([s_ in r_['off'] for r_ in reps]) for s_ in sysnames if streak([s_ in r_['off'] for r_ in reps]) >= 2},
               leakStreak=streak([r_['leak'] for r_ in reps]), pestStreak=streak([bool(r_['pest']) for r_ in reps]),
               anyOffStreak=streak([bool(r_['off']) for r_ in reps]),
               lastSeed=next((r_['seed'] for r_ in reversed(reps) if r_['seed']), None),
               nextHarvest=nh_dates[-1][1] if nh_dates else None,
               pestKinds=sorted({r_['pest'] for r_ in reps if r_['pest']}))
    hv = []
    for _, r in gs.iterrows():
        h1 = clean(r['Did you harvest today?'])
        h2 = clean(r['Has there been a harvest (partial or full) since your last visit?'])
        w = r['Total weight of crops harvested (INCLUDE UNITS: oz, gr, lb)']
        if h1 or h2 or clean(w):
            lb, amb = weight_lbs(w)
            hv.append(dict(d=iso(r.vd), lb=lb, amb=amb, raw=clean(w), crops=clean(r['Types of crops harvested'])))
    amv = []
    for _, r in am_.iterrows():
        d = pdate(r['Visit date']) or title_date(r['Title'])
        amv.append(dict(d=iso(d), am=first(r['Manager']), tconv=clean(r['In-person conversation w/ teacher about GHC?']),
                        pconv=clean(r['In-person conversation w/ principal/vice principal?']), fu=clean(r['If no, follow-up email sent?']),
                        curr=clean(r['Is the teacher using the curriculum?']),
                        imp=num_rating(r['Please rate the your overall impression of the lab:']),
                        inv=num_rating(r['Please rate the level of teacher involvement/communication']),
                        clean=num_rating(r['Please rate the level of lab cleanliness/organization']),
                        note=snip(r['General Notes, Comments, or Concerns'], 420)))
    amv.sort(key=lambda x: x['d'] or '')
    ed = []
    for _, r in es.iterrows():
        sd = clean(r['Select the Teacher Training Session Completed'])
        t = str(r['Title'])
        com = clean(r['Comments and observations'])
        ns = bool(re.search(r'no.?show', t + ' ' + (com or ''), re.I))
        d = pd.to_datetime(str(r['Date']).split(' ')[0], errors='coerce')
        rub = {n: (None if pd.isna(r['Rubric: ' + n]) else float(r['Rubric: ' + n]))
               for n in ['Knowledge', 'Skills', 'Farmer Scientist Identity', 'Global Citizen Identity', 'Curriculum']}
        ed.append(dict(d=iso(d), sess=sd, ns=ns, dur=clean(r['Session Duration']),
                       teachers=clean(r['Name of Teachers Trained']), type=clean(r['Type of Session']),
                       eng=clean(r['Teacher Engagement']), rub=rub, spec=clean(r['NYSW Curriculum Specialist']),
                       note=snip(com, 420), title=snip(t, 80)))
    ed.sort(key=lambda x: x['d'] or '')
    gtr = [dict(d=iso(r.vd), sess=clean(r['Select Teacher Training Session Complete']),
                teachers=clean(r['Name of the Teachers Trained']))
           for _, r in gs.iterrows() if clean(r['Select Teacher Training Session Complete'])]
    aff = [(iso(r.vd), clean(r['Affiliation'])) for _, r in gs.iterrows() if clean(r['Affiliation'])]
    schools[k] = dict(code=k, name=re.sub(r'^[KMQXR]\d{3}\s+', '', nm), full=nm, isSchool=bool(CODE_RE.match(nm)),
                      borough=mv('1.3 Borough (or State)') or c.get('borough'), span=mv('1.2 School Grades'),
                      installQ=mv('4.3 Installation Quarter') or c.get('installationDate'),
                      cpf=bool(mv('5.4 CPF Funding')), nypa=bool(mv('5.5 NYPA 26/27')), am=am, amSrc=amsrc, amPhase1=p1,
                      gst=first(gst) if gst else None, gstAll=[first(x) for x, _ in gcount.most_common(3)],
                      programYear=c.get('programYear'), specialist=c.get('curriculumSpecialist'),
                      labs=c.get('numLabs'), systems=c.get('systemsInstalled'), aqx=c.get('hasAquaponics'),
                      visitDay=visit_day, cadence=cad.get(k), onSchedule=k in sched_keys, weeks=weeks,
                      reports=reps[-6:], agg=agg, nReports=len(reps), lastVisit=iso(gs.vd.max()) if len(gs) else None,
                      harvest=hv, amv=amv, ed=ed, gtr=gtr, aff=aff, tt=tt_weeks.get(k, []))


# ---------- reconcile with hand-built Missing Assets sheets ----------
MA = D + r"\Missing Assets 26_27.xlsx"
wk_map = {'Sept 7-11': '2026-09-07', 'Sept 14-18': '2026-09-14', 'Sept 21-25': '2026-09-21', 'Sept 28-Oct 2': '2026-09-28',
          'Oct 4-9': '2026-10-05', 'Oct 12-16': '2026-10-12', 'Oct 19-23': '2026-10-19', 'Oct 26-30': '2026-10-26'}
rec = {}
CODE2 = re.compile(r'([KMQXR]\d{3})', re.I)
doneByWeek = collections.defaultdict(set)
for k, sch in schools.items():
    for w in sch['weeks']:
        if w['d']:
            doneByWeek[w['w']].add(k)
schedByWeek = collections.defaultdict(set)
for k, sch in schools.items():
    for w in sch['weeks']:
        if w['s']:
            schedByWeek[w['w']].add(k)
for sh, w in wk_map.items():
    df = pd.read_excel(MA, sheet_name=sh, header=0)
    mcol = [c for c in df.columns if 'Missing' in str(c)][0]
    ccol = [c for c in df.columns if 'Completed' in str(c)][0]
    miss, comp, eowmiss = set(), set(), 0
    for _, r in df.iterrows():
        mt = str(r[mcol]) if pd.notna(r[mcol]) else ''
        ct = str(r[ccol]) if pd.notna(r[ccol]) else ''
        for part in mt.split(','):
            m = CODE2.search(part)
            if m:
                miss.add(m.group(1).upper())
                if re.search(r'eow|monthly|every other', part, re.I):
                    eowmiss += 1
        for part in ct.split(','):
            m = CODE2.search(part)
            if m:
                comp.add(m.group(1).upper())
    rec[w] = dict(manual_missing=len(miss), manual_missing_but_logged=len(miss & doneByWeek[w]),
                  manual_missing_cadence_tagged=eowmiss, manual_completed=len(comp),
                  manual_completed_not_in_export=len(comp - doneByWeek[w]),
                  scheduled=len(schedByWeek[w]), logged=len(doneByWeek[w] & schedByWeek[w]))
diag['reconcile'] = rec
print(json.dumps(rec, indent=1))
json.dump(schools, open('schools_raw.json', 'w'), default=str)
json.dump(diag, open('diag.json', 'w'), indent=1, default=str)
print(len(schools), 'schools written')
