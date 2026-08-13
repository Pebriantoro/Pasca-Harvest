/* =====================================================================
   BERANDA WEATHER WIDGET — ADDITIF, load setelah beranda.js.
   Card cuaca real (gaya widget cuaca iOS) di paling atas halaman Beranda
   (tampilan awal setelah login): lokasi, suhu besar, kondisi, H/L.
   Pakai Open-Meteo (gratis, tanpa API key) utk cuaca + BigDataCloud
   (gratis, tanpa API key) utk reverse-geocode nama lokasi.
   Nge-wrap renderBeranda non-destruktif (pola sama kayak beranda.js
   nge-wrap navigate) — tidak mengubah logic Beranda yang sudah ada.
   ===================================================================== */
(function(){
  const BW_FALLBACK_COORD = { lat: -5.45, lon: 105.27 }; // Bandar Lampung

  const BW_COND_TEXT = {
    0: 'Cerah', 1: 'Cerah Berawan', 2: 'Berawan Sebagian', 3: 'Mendung',
    45: 'Berkabut', 48: 'Berkabut',
    51: 'Gerimis Ringan', 53: 'Gerimis', 55: 'Gerimis Lebat',
    56: 'Gerimis Beku', 57: 'Gerimis Beku Lebat',
    61: 'Hujan Ringan', 63: 'Hujan', 65: 'Hujan Lebat',
    66: 'Hujan Beku', 67: 'Hujan Beku Lebat',
    71: 'Salju Ringan', 73: 'Salju', 75: 'Salju Lebat',
    80: 'Hujan Ringan', 81: 'Hujan', 82: 'Hujan Sangat Lebat',
    95: 'Badai Petir', 96: 'Badai Petir', 99: 'Badai Petir'
  };

  function bwCondClass(code, isDay){
    if(code === 0) return isDay ? 'wx-clear-day' : 'wx-clear-night';
    if([1,2,3].includes(code)) return 'wx-cloudy';
    if([45,48].includes(code)) return 'wx-fog';
    if([95,96,99].includes(code)) return 'wx-storm';
    return 'wx-rain';
  }

  function bwBuildWidget(){
    const content = document.getElementById('pageContent');
    if(!content) return null;
    const wrap = document.createElement('div');
    wrap.className = 'login-weather-widget beranda-weather-widget anim-scale-in';
    wrap.id = 'berandaWeatherWidget';
    wrap.innerHTML = `
      <div class="lw-sun" aria-hidden="true"></div>
      <div class="lw-cloud lw-cloud-a" aria-hidden="true"></div>
      <div class="lw-cloud lw-cloud-b" aria-hidden="true"></div>
      <div class="lw-label">Lokasi Saya</div>
      <div class="lw-city" id="bwCity">Mencari lokasi…</div>
      <div class="lw-temp"><span id="bwTemp">–</span>°</div>
      <div class="lw-cond" id="bwCond">Memuat cuaca…</div>
      <div class="lw-hilo"><span>H:<span id="bwHigh">–</span>°</span>&nbsp;&nbsp;<span>L:<span id="bwLow">–</span>°</span></div>
    `;
    content.insertBefore(wrap, content.firstChild);
    return wrap;
  }

  async function bwFetchWeather(lat, lon){
    let widget = document.getElementById('berandaWeatherWidget') || bwBuildWidget();
    if(!widget) return;

    try{
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
      const res = await fetch(url);
      if(!res.ok) throw new Error('cuaca gagal');
      const data = await res.json();
      const cw = data.current_weather;
      if(!cw) throw new Error('data cuaca kosong');

      const cls = bwCondClass(cw.weathercode, cw.is_day === 1);
      widget.classList.remove('wx-clear-day','wx-clear-night','wx-cloudy','wx-rain','wx-storm','wx-fog');
      widget.classList.add(cls);
      widget.classList.toggle('lw-night', cls === 'wx-clear-night');

      document.getElementById('bwTemp').textContent = Math.round(cw.temperature);
      document.getElementById('bwCond').textContent = BW_COND_TEXT[cw.weathercode] || 'Cerah Berawan';
      const hi = data.daily?.temperature_2m_max?.[0];
      const lo = data.daily?.temperature_2m_min?.[0];
      document.getElementById('bwHigh').textContent = hi != null ? Math.round(hi) : '–';
      document.getElementById('bwLow').textContent = lo != null ? Math.round(lo) : '–';
    }catch(err){
      widget.classList.add('wx-cloudy'); // gagal ambil data -> fallback netral
    }
  }

  async function bwFetchLocationName(lat, lon){
    const el = document.getElementById('bwCity');
    if(!el) return;
    try{
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`;
      const res = await fetch(url);
      if(!res.ok) throw new Error('lokasi gagal');
      const data = await res.json();
      const name = data.city || data.locality || data.principalSubdivision || 'Lokasi Anda';
      el.textContent = name;
    }catch(err){
      el.textContent = 'Lokasi Anda';
    }
  }

  let bwLoaded = false;
  function bwLoad(){
    if(bwLoaded) return; // sekali per sesi cukup, ga perlu fetch ulang tiap balik ke Beranda
    bwLoaded = true;
    function loadWithCoord(lat, lon){
      bwFetchWeather(lat, lon);
      bwFetchLocationName(lat, lon);
    }
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        pos => loadWithCoord(pos.coords.latitude, pos.coords.longitude),
        () => loadWithCoord(BW_FALLBACK_COORD.lat, BW_FALLBACK_COORD.lon),
        { timeout: 6000 }
      );
    } else {
      loadWithCoord(BW_FALLBACK_COORD.lat, BW_FALLBACK_COORD.lon);
    }
  }

  if(typeof renderBeranda === 'function'){
    const _bwPrevRenderBeranda = renderBeranda;
    renderBeranda = async function(){
      await _bwPrevRenderBeranda();
      if(currentProfile?.role === 'viewer') return; // sama kayak guard asli, ga ada #pageContent card di role ini
      bwBuildWidget();
      bwLoad();
    };
  }
})();
