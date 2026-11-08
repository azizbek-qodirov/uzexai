"""Refresh every published WeeklyQuotes period, following pagination. Python 3, no dependencies."""
import re, html, json, urllib.request, datetime, pathlib, time
ROOT = pathlib.Path(__file__).resolve().parents[1]
def fetch(url):
    for attempt in range(3):
        try: return urllib.request.urlopen(url, timeout=60).read().decode('utf-8')
        except Exception:
            if attempt == 2: raise
            time.sleep(1)
def parse(s):
    result=[]
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', s, re.S):
        cells=[html.unescape(re.sub('<[^>]+>', '', x)).strip() for x in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(cells)==7:
            for k in [2,3]: cells[k]=float(re.sub(r'\s','',cells[k]).replace(',','.'))
            cells[0]=int(cells[0])
            result.append(cells)
    return result
if __name__=='__main__':
    page=fetch('https://uzex.uz/WeeklyQuotes')
    select=re.search(r'<select[^>]*id="ImportId".*?</select>',page,re.S).group()
    periods=re.findall(r'<option value="(\d+)"[^>]*>(.*?)</option>',select,re.S)
    output=ROOT/'data/quotes';output.mkdir(parents=True,exist_ok=True)
    manifest={'fetched_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'periods':[]}
    for ident,label in periods:
        result=[];n=1
        while True:
            url=f'https://uzex.uz/WeeklyQuotes?ImportId={ident}&Length=1000&page={n}'
            batch=parse(fetch(url));result+=batch
            if len(batch)<1000:break
            n+=1
        assert result and [r[0] for r in result]==list(range(1,len(result)+1)), 'Incomplete pagination'
        (output/f'{ident}.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
        manifest['periods'].append({'id':int(ident),'label':html.unescape(label),'count':len(result),'url':f'https://uzex.uz/WeeklyQuotes?ImportId={ident}'})
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
