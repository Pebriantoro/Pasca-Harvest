/* =====================================================================
   LOGIN WEATHER WIDGET — ADDITIF, load paling terakhir.
   Card cuaca real (gaya widget cuaca iOS) di ATAS form login: lokasi,
   suhu besar, kondisi, H/L. Video background login TIDAK diubah.
   Pakai Open-Meteo (gratis, tanpa API key) utk cuaca + BigDataCloud
   (gratis, tanpa API key) utk reverse-geocode nama lokasi.
   Tidak mengubah logic login/auth apapun — murni widget dekoratif.
   ===================================================================== */
(function(){
  const LW_FALLBACK_COORD = { lat: -5.45, lon: 105.27 }; // Bandar Lampung

  const LW_COND_TEXT = {
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

  function lwCondClass(code, isDay){
    if(code === 0) return isDay ? 'wx-clear-day' : 'wx-clear-night';
    if([1,2,3].includes(code)) return 'wx-cloudy';
    if([45,48].includes(code)) return 'wx-fog';
    if([95,96,99].includes(code)) return 'wx-storm';
    return 'wx-rain';
  }

  function lwBuildWidget(){
    const card = document.querySelector('.login-card');
    if(!card || !card.parentNode) return null;
    const wrap = document.createElement('div');
    wrap.className = 'login-weather-widget anim-scale-in';
    wrap.id = 'loginWeatherWidget';
    wrap.innerHTML = `
      <div class="lw-sun" aria-hidden="true"></div>
      <div class="lw-cloud lw-cloud-a" aria-hidden="true"></div>
      <div class="lw-cloud lw-cloud-b" aria-hidden="true"></div>
      <div class="lw-label">Lokasi Saya</div>
      <div class="lw-city" id="lwCity">Mencari lokasi…</div>
      <div class="lw-temp"><span id="lwTemp">–</span>°</div>
      <div class="lw-cond" id="lwCond">Memuat cuaca…</div>
      <div class="lw-hilo"><span>H:<span id="lwHigh">–</span>°</span>&nbsp;&nbsp;<span>L:<span id="lwLow">–</span>°</span></div>
    `;
    card.parentNode.insertBefore(wrap, card);
    return wrap;
  }

  async function lwFetchWeather(lat, lon){
    let widget = document.getElementById('loginWeatherWidget') || lwBuildWidget();
    if(!widget) return;

    try{
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
      const res = await fetch(url);
      if(!res.ok) throw new Error('cuaca gagal');
      const data = await res.json();
      const cw = data.current_weather;
      if(!cw) throw new Error('data cuaca kosong');

      const cls = lwCondClass(cw.weathercode, cw.is_day === 1);
      widget.classList.remove('wx-clear-day','wx-clear-night','wx-cloudy','wx-rain','wx-storm','wx-fog');
      widget.classList.add(cls);
      widget.classList.toggle('lw-night', cls === 'wx-clear-night');

      document.getElementById('lwTemp').textContent = Math.round(cw.temperature);
      document.getElementById('lwCond').textContent = LW_COND_TEXT[cw.weathercode] || 'Cerah Berawan';
      const hi = data.daily?.temperature_2m_max?.[0];
      const lo = data.daily?.temperature_2m_min?.[0];
      document.getElementById('lwHigh').textContent = hi != null ? Math.round(hi) : '–';
      document.getElementById('lwLow').textContent = lo != null ? Math.round(lo) : '–';
    }catch(err){
      widget.classList.add('wx-cloudy'); // gagal ambil data -> fallback netral
    }
  }

  async function lwFetchLocationName(lat, lon){
    const el = document.getElementById('lwCity');
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

  function lwInit(){
    if(!document.querySelector('.login-card')) return;
    function loadWithCoord(lat, lon){
      lwFetchWeather(lat, lon);
      lwFetchLocationName(lat, lon);
    }
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        pos => loadWithCoord(pos.coords.latitude, pos.coords.longitude),
        () => loadWithCoord(LW_FALLBACK_COORD.lat, LW_FALLBACK_COORD.lon),
        { timeout: 6000 }
      );
    } else {
      loadWithCoord(LW_FALLBACK_COORD.lat, LW_FALLBACK_COORD.lon);
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lwInit);
  else lwInit();
})();
