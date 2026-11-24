t=open('template.html',encoding='utf8').read()
d=open('data.js',encoding='utf8').read().replace('</script>','<\/script>')
open(r'C:/Users/nishi/Documents/NYSW Partner School Dashboard v2/NYSW_Partner_School_Dashboard.html','w',encoding='utf8').write(t.replace('/*__DATA__*/',d))
print('ok')
