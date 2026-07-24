/* =====================================================================
   LOGIN QUOTE ROTATOR — ADDITIF, load PALING TERAKHIR.
   Menampilkan kutipan motivasi bergantian tiap 5 detik di area bawah
   kartu login, menyatu (blur + blend) dengan video background.
   ===================================================================== */

const LOGIN_QUOTES = [
  "Kesuksesan tidak datang kepada kita, kita yang harus mengejarnya dengan kerja keras dan ketekunan.",
  "Bekerja keras adalah jalan menuju impian yang lebih besar.",
  "Jangan takut gagal, karena kegagalan adalah pelajaran untuk kesuksesan yang lebih besar.",
  "Setiap langkah kecil menuju tujuan adalah kemajuan yang berharga.",
  "Keberhasilan tidak dilihat dari seberapa cepat kita mencapainya, tetapi dari seberapa konsisten kita bertahan dalam prosesnya.",
  "Kerja keras akan membawa hasil, tetapi kerja cerdas akan mempercepat kesuksesan.",
  "Jangan menunggu kesempatan datang, buatlah kesempatan dengan usaha dan tindakan.",
  "Setiap hari adalah peluang baru untuk menjadi lebih baik dari hari kemarin.",
  "Bekerja dengan penuh hati akan memberikan hasil yang luar biasa.",
  "Kerja keras adalah investasi terbaik untuk masa depan.",
  "Tidak ada yang mustahil jika kita berusaha dengan sepenuh hati.",
  "Mimpi besar hanya bisa dicapai dengan kerja keras dan ketekunan.",
  "Kesuksesan dimulai dari keinginan untuk terus belajar dan berkembang.",
  "Setiap tantangan adalah peluang untuk menjadi lebih kuat.",
  "Jangan biarkan kegagalan menghentikanmu. Gunakan kegagalan sebagai batu loncatan menuju kesuksesan.",
  "Sukses bukan tentang seberapa banyak yang kita miliki, tetapi tentang seberapa banyak yang kita berikan.",
  "Pekerjaan yang dilakukan dengan sepenuh hati akan selalu memberikan hasil yang terbaik.",
  "Kerja keras adalah kunci utama untuk membuka pintu kesuksesan.",
  "Tidak ada yang lebih memuaskan selain melihat hasil kerja keras yang berbuah manis.",
  "Keberhasilan bukan hanya tentang apa yang kita capai, tetapi juga tentang bagaimana kita mencapainya.",
  "Jangan menunggu motivasi datang, ciptakanlah dengan tindakan nyata.",
  "Bekerja keras hari ini untuk kebahagiaan masa depan.",
  "Setiap kegagalan adalah kesempatan untuk memulai lagi dengan lebih bijaksana.",
  "Orang sukses bukan mereka yang tidak pernah gagal, tapi mereka yang tidak pernah menyerah.",
  "Keberhasilan dimulai dari kemauan untuk terus berusaha meski dalam keadaan sulit.",
  "Jangan berhenti ketika kamu lelah, berhentilah ketika kamu sudah mencapai tujuan.",
  "Jangan takut untuk berbuat salah, karena kesalahan adalah cara terbaik untuk belajar.",
  "Pekerjaan yang baik adalah pekerjaan yang dilakukan dengan penuh rasa tanggung jawab.",
  "Semangat kerja adalah kunci untuk mencapai segala tujuan yang diinginkan.",
  "Setiap orang punya kesempatan untuk sukses, yang membedakan adalah usaha yang dilakukan.",
  "Kerja keras tidak akan mengkhianati hasil, hasillah yang akan mengungkapkan kerja keras.",
  "Tidak ada jalan pintas menuju kesuksesan, hanya ada kerja keras yang konsisten.",
  "Jadikan pekerjaanmu sebagai jalan untuk mengembangkan dirimu menjadi pribadi yang lebih baik.",
  "Tantangan adalah kesempatan untuk menunjukkan kekuatanmu yang sebenarnya.",
  "Sukses bukan milik mereka yang cerdas, tetapi mereka yang bekerja lebih keras.",
  "Bekerjalah seolah-olah itu adalah pekerjaan terakhir yang kamu lakukan.",
  "Jangan terlalu khawatir tentang hasil, fokuslah pada usaha yang terbaik.",
  "Setiap hari adalah kesempatan untuk melakukan sesuatu yang lebih baik dari hari sebelumnya.",
  "Kesuksesan adalah akumulasi dari upaya kecil yang dilakukan setiap hari.",
  "Bekerja dengan cinta akan membuat hasilnya lebih berharga.",
  "Setiap kesulitan adalah batu loncatan menuju kesuksesan.",
  "Tantangan bukan untuk ditakuti, tetapi untuk dihadapi dengan keberanian.",
  "Jangan biarkan rintangan menghentikan langkahmu, jadikan itu sebagai tantangan yang harus kamu taklukkan.",
  "Keberanian untuk mencoba adalah langkah pertama menuju kesuksesan.",
  "Jangan berhenti ketika kamu menghadapi masalah, teruslah bergerak maju.",
  "Kesuksesan tidak diukur dari seberapa banyak kita menghindari kegagalan, tetapi dari seberapa banyak kita bangkit setelah kegagalan.",
  "Setiap tantangan memberikan kesempatan untuk berkembang menjadi pribadi yang lebih baik.",
  "Jika kamu berhenti berusaha, kamu akan kehilangan kesempatan untuk sukses.",
  "Pekerjaan yang sulit biasanya menghasilkan hasil yang luar biasa.",
  "Keberhasilan bukan tentang berapa kali kita jatuh, tetapi tentang berapa kali kita bangkit.",
  "Tantangan adalah cara hidup untuk menguji sejauh mana kita mampu bertahan.",
  "Jangan pernah meremehkan kekuatan semangat dan kerja keras.",
  "Tantangan adalah kesempatan untuk membuktikan kemampuan diri.",
  "Jangan takut pada tantangan, karena di sana tersembunyi peluang besar.",
  "Kegagalan adalah guru terbaik yang mengajarkan kita untuk lebih bijaksana.",
  "Setiap tantangan adalah kesempatan untuk belajar dan berkembang.",
  "Tidak ada pencapaian besar yang bisa diraih tanpa melewati banyak tantangan.",
  "Keberhasilan tidak datang dengan mudah, tetapi perjuangan membuatnya lebih berharga.",
  "Tantangan akan membuatmu lebih kuat, lebih bijaksana, dan lebih siap menghadapi masa depan.",
  "Berani menghadapi tantangan adalah langkah pertama menuju kesuksesan.",
  "Jangan menyerah, karena kamu tidak pernah tahu seberapa dekat kamu dengan kesuksesan.",
  "Kegagalan bukan akhir dari segalanya, itu hanya permulaan untuk mencoba lagi dengan lebih baik.",
  "Jangan berhenti berusaha hanya karena kamu merasa lelah, keberhasilan sudah menunggu di depan sana.",
  "Semangat yang kuat akan mengatasi segala hambatan yang ada.",
  "Saat kamu merasa lelah, ingatlah alasan mengapa kamu mulai.",
  "Keberhasilan datang kepada mereka yang tidak pernah menyerah meskipun keadaan sangat sulit.",
  "Setiap usaha yang dilakukan dengan hati akan selalu membuahkan hasil.",
  "Jangan biarkan kegagalan hari ini menghalangi kesuksesan besok.",
  "Kamu lebih kuat dari yang kamu kira, jangan pernah menyerah.",
  "Keputusasaan hanya sementara, sementara hasil dari usaha terus berlanjut.",
  "Setiap tantangan yang kamu hadapi adalah kesempatan untuk tumbuh.",
  "Jangan berhenti ketika kamu kelelahan, berhentilah ketika kamu sudah berhasil.",
  "Keberhasilan terbesar datang dari ketekunan yang tidak kenal lelah.",
  "Setiap hari adalah peluang untuk memperbaiki diri dan mencapai tujuan.",
  "Jangan pernah menyerah pada impianmu hanya karena kesulitan yang kamu hadapi.",
  "Mimpi akan menjadi kenyataan jika kamu tetap bertahan untuk mencapainya.",
  "Jangan takut untuk memulai dari awal, karena setiap langkah adalah kemajuan.",
  "Keberhasilan tidak akan datang dengan mudah, tetapi itu pasti datang jika kita tidak berhenti berusaha.",
  "Bangkitlah setelah jatuh, karena di setiap kegagalan terdapat pelajaran berharga.",
  "Tantangan yang kita hadapi akan semakin mudah ketika kita memiliki tekad yang kuat.",
  "Setiap hari adalah kesempatan baru untuk mencapai tujuan yang lebih besar.",
  "Produktivitas bukan tentang berapa lama kamu bekerja, tetapi tentang bagaimana kamu memanfaatkan waktu.",
  "Jangan fokus pada berapa banyak pekerjaan yang perlu diselesaikan, tetapi pada kualitas setiap tugas yang dikerjakan.",
  "Kerja cerdas lebih baik daripada kerja keras tanpa arah.",
  "Jangan menunda pekerjaan yang bisa diselesaikan hari ini, karena setiap hari adalah peluang untuk lebih baik.",
  "Fokus pada tujuan, dan hasil akan mengikuti.",
  "Produktivitas bukan hanya tentang bekerja keras, tetapi bekerja dengan cerdas.",
  "Atur prioritas, selesaikan yang penting dulu, dan lihat bagaimana hari-harimu berubah.",
  "Kerja keras yang konsisten akan menghasilkan produktivitas yang luar biasa.",
  "Produktivitas datang dari kebiasaan yang baik dan disiplin dalam bekerja.",
  "Jadikan setiap tugas sebagai peluang untuk meningkatkan kemampuan diri.",
  "Semakin baik kita mengelola waktu, semakin besar pula pencapaian yang kita raih.",
  "Produktivitas bukan tentang bekerja lebih keras, tetapi bekerja lebih pintar.",
  "Ciptakan tujuan yang jelas, dan capailah dengan langkah-langkah yang terorganisir.",
  "Jadikan waktu sebagai teman terbaik dalam meraih kesuksesan.",
  "Setiap hari adalah kesempatan untuk bekerja lebih baik dari hari sebelumnya.",
  "Bekerja dengan fokus akan meningkatkan kualitas pekerjaan dan hasil yang didapat.",
  "Bekerja dengan hati adalah cara terbaik untuk tetap produktif.",
  "Produktivitas dimulai dari kemauan untuk bekerja dengan disiplin dan penuh tanggung jawab.",
  "Jangan biarkan gangguan menghalangi produktivitasmu, fokuslah pada tujuan."
];

let _loginQuoteIdx = -1;
let _loginQuoteTimer = null;

function _pickNextQuoteIdx(){
  if(LOGIN_QUOTES.length <= 1) return 0;
  let next;
  do { next = Math.floor(Math.random() * LOGIN_QUOTES.length); } while(next === _loginQuoteIdx);
  return next;
}

function showNextLoginQuote(){
  const el = document.getElementById('loginQuote');
  if(!el) return;
  el.classList.remove('show');
  setTimeout(() => {
    _loginQuoteIdx = _pickNextQuoteIdx();
    el.textContent = '"' + LOGIN_QUOTES[_loginQuoteIdx] + '"';
    el.classList.add('show');
  }, 550);
}

function startLoginQuoteRotator(){
  if(_loginQuoteTimer) return; // sudah jalan, jangan dobel
  showNextLoginQuote();
  _loginQuoteTimer = setInterval(showNextLoginQuote, 10000);
}

document.addEventListener('DOMContentLoaded', startLoginQuoteRotator);
if(document.readyState === 'complete' || document.readyState === 'interactive') startLoginQuoteRotator();
