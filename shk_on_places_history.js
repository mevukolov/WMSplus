(function(){

    /* ===== TOAST SAFE ===== */
    function toast(msg, opts = {}) {
        if (typeof createToast === 'function') {
            createToast(msg, opts);
        } else {
            alert(msg);
        }
    }


    /* ===== DOM ===== */
    const typeEl = document.getElementById('search-type');
    const valueEl = document.getElementById('search-value');
    const dateFromEl = document.getElementById('date-from');
    const timeFromEl = document.getElementById('time-from');
    const dateToEl = document.getElementById('date-to');
    const timeToEl = document.getElementById('time-to');
    const searchBtn = document.getElementById('search-btn');
    const tableWrap = document.getElementById('table-wrap');
    const resultBody = document.getElementById('result-body');
    const exportBtn = document.getElementById('export-btn');

    /* ===== AUTO FORMAT ===== */
    function autoDate(el){
        el.addEventListener('input', e=>{
            if(e.inputType === 'insertFromPaste') return;
            let v = el.value.replace(/\D/g,'').slice(0,8);
            if(v.length>=3) v=v.slice(0,2)+'.'+v.slice(2);
            if(v.length>=6) v=v.slice(0,5)+'.'+v.slice(5);
            el.value=v;
        });
    }
    function autoTime(el){
        el.addEventListener('input', e=>{
            if(e.inputType === 'insertFromPaste') return;
            let v = el.value.replace(/\D/g,'').slice(0,6);
            if(v.length>=3) v=v.slice(0,2)+':'+v.slice(2);
            if(v.length>=6) v=v.slice(0,5)+':'+v.slice(5);
            el.value=v;
        });
    }

    autoDate(dateFromEl);
    autoDate(dateToEl);
    autoTime(timeFromEl);
    autoTime(timeToEl);

    let lastResult = [];

    /* ===== SEARCH ===== */
    async function search(){

        const hasInput =
            valueEl.value ||
            dateFromEl.value ||
            dateToEl.value ||
            timeFromEl.value ||
            timeToEl.value;

        if(!hasInput){
            toast('Ничего не введено', { type:'error' });
            return;
        }

        tableWrap.style.display='none';
        exportBtn.style.display='none';
        resultBody.innerHTML='';

        let q = supabaseClient
            .from('shk_rep')
            .select('*')
            .order('date',{ascending:false});

        const type = typeEl.value;
        const val = valueEl.value.trim();

        if(type==='emp' && val){
            q = q.eq('emp', val);
        }

        if(type==='place' && val){
            const { data: places } = await supabaseClient
                .from('places')
                .select('place')
                .or(`place.eq.${val},place_name.ilike.%${val}%`);

            if(!places?.length){
                toast('Ничего не найдено', { type:'info' });
                return;
            }

            q = q.in('place', places.map(p=>p.place));
        }

        function iso(d,t){
            if(!d) return null;
            const [dd,mm,yy]=d.split('.');
            return `${yy}-${mm}-${dd}T${t||'00:00:00'}.000Z`;
        }

        const from = iso(dateFromEl.value,timeFromEl.value);
        const to = iso(dateToEl.value,timeToEl.value);
        if(from) q=q.gte('date',from);
        if(to) q=q.lte('date',to);

        const { data, error } = await q;
        if(error){
            toast('Ошибка поиска', { type:'error' });
            return;
        }

        if(!data?.length){
            toast('Ничего не найдено', { type:'info' });
            return;
        }

        lastResult=data;

        data.forEach(r=>{
            const tr=document.createElement('tr');
            tr.innerHTML=`
        <td>${new Date(r.date).toLocaleString('ru-RU')}</td>
        <td>${r.shk}</td>
        <td>${r.operation}</td>
        <td>${r.place||''}</td>
        <td>${r.place_new||''}</td>
        <td>${r.emp||''}</td>
      `;
            resultBody.appendChild(tr);
        });

        tableWrap.style.display='';
        exportBtn.style.display='';
    }

    /* ===== EXPORT UTF-8 BOM ===== */
    exportBtn.onclick=()=>{
        const rows=[
            ['Дата','Значение','Операция','МХ','Новое МХ','Сотрудник'],
            ...lastResult.map(r=>[
                new Date(r.date).toLocaleString('ru-RU'),
                r.shk,r.operation,r.place||'',r.place_new||'',r.emp||''
            ])
        ];
        const csv='\uFEFF'+rows.map(r=>r.join(';')).join('\n');
        const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=`shk_history_${Date.now()}.csv`;
        a.click();
    };

    searchBtn.onclick=search;
    document.addEventListener('keydown',e=>{
        if(e.key==='Enter') search();
    });

})();
