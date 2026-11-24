import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface BannerSlide {
  id: string;
  image: string;
  location: string;
  title: string;
  caption: string;
}

const NAGEKEO_SLIDES: BannerSlide[] = [
  {
    id: 'mbay',
    image: '/src/assets/images/banner_nagekeo_mbay_1795067180507.jpg',
    location: 'Kecamatan Aesesa · Daerah Irigasi Mbay',
    title: 'Lumbung Pangan & Ketahanan Pertanian Nagekeo',
    caption:
      'Integrasi data sektoral luas tanam, produksi padi, dan jaringan irigasi teknis langsung dari Google Sheet produsen data.',
  },
  {
    id: 'tutubhada',
    image: '/src/assets/images/banner_nagekeo_tutubhada_1795067180076.jpg',
    location: 'Kecamatan Aesesa Selatan · Kampung Adat Tutubhada',
    title: 'Pelestarian Warisan Budaya & Pariwisata Daerah',
    caption:
      'Pemutakhiran indikator destinasi wisata, desa wisata, dan cagar budaya secara terstruktur oleh Dinas Pariwisata dan Disdikbud.',
  },
  {
    id: 'riitaa',
    image: '/src/assets/images/banner_nagekeo_riitaa_1795067180330.jpg',
    location: 'Pesisir Utara Nagekeo · Pulau Rii Ta’a',
    title: 'Potensi Kelautan, Perikanan & Ekonomi Biru',
    caption:
      'Pencatatan produksi perikanan tangkap, budidaya, dan rumah tangga nelayan terhubung langsung ke Satu Data Kabupaten Nagekeo.',
  },
  {
    id: 'ebulobo',
    image: '/src/assets/images/banner_nagekeo_ebulobo_1795067180976.jpg',
    location: 'Dataran Tinggi Boawae · Gunung Ebulobo',
    title: 'Pembangunan Berbasis Data Lintas 7 Kecamatan',
    caption:
      'Konsolidasi data kependudukan, kesehatan, pendidikan, dan infrastruktur untuk perencanaan pembangunan yang terukur.',
  },
  {
    id: 'civic',
    image: '/src/assets/images/banner_nagekeo_civic_1795067180185.jpg',
    location: 'Mbay · Pusat Pemerintahan Kabupaten Nagekeo',
    title: 'Tata Kelola Satu Data Indonesia Kabupaten Nagekeo',
    caption:
      'Sinergi Walidata Diskominfo dan seluruh Organisasi Perangkat Daerah demi data sektoral yang akurat, mutakhir, dan dapat dipertanggungjawabkan.',
  },
];

interface HeroBannerSliderProps {
  compact?: boolean;
}

export function HeroBannerSlider({ compact = false }: HeroBannerSliderProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % NAGEKEO_SLIDES.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [paused]);

  const current = NAGEKEO_SLIDES[activeIndex];

  const handlePrev = () => {
    setActiveIndex(
      (prev) => (prev - 1 + NAGEKEO_SLIDES.length) % NAGEKEO_SLIDES.length
    );
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev + 1) % NAGEKEO_SLIDES.length);
  };

  return (
    <section
      aria-label="Galeri Sorotan Kabupaten Nagekeo"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`relative w-full overflow-hidden rounded-xl border border-slate-200/80 bg-[#07131F] shadow-[0_8px_30px_-14px_rgba(7,19,31,0.35)] ${
        compact ? 'h-[220px] sm:h-[260px]' : 'h-[260px] sm:h-[320px] lg:h-[360px]'
      }`}
    >
      {/* Background Slides */}
      {NAGEKEO_SLIDES.map((slide, index) => {
        const isActive = index === activeIndex;
        const hasFailed = failedImages[slide.id];
        return (
          <div
            key={slide.id}
            aria-hidden={!isActive}
            className={`absolute inset-0 transition-opacity duration-500 ${
              isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
            }`}
          >
            {!hasFailed ? (
              <img
                src={slide.image}
                alt={slide.title}
                referrerPolicy="no-referrer"
                onError={() =>
                  setFailedImages((prev) => ({ ...prev, [slide.id]: true }))
                }
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#07131F] via-[#132F4C] to-[#0F4C5C]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#07131F]/90 via-[#07131F]/40 to-[#07131F]/10" />
          </div>
        );
      })}

      {/* Slide Content Overlay */}
      <div className="relative z-20 h-full flex flex-col justify-between p-5 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-teal-200 tracking-wide">
            {current.location}
          </span>
          <span className="font-mono tabular-nums text-xs text-slate-200">
            {activeIndex + 1} / {NAGEKEO_SLIDES.length}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-white leading-snug">
              {current.title}
            </h2>
            <p className="mt-1.5 text-xs sm:text-sm text-slate-200 leading-relaxed line-clamp-2">
              {current.caption}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 mr-2" role="tablist" aria-label="Pilih slide banner">
              {NAGEKEO_SLIDES.map((slide, idx) => (
                <button
                  key={slide.id}
                  type="button"
                  role="tab"
                  aria-selected={idx === activeIndex}
                  aria-label={`Slide ${idx + 1}: ${slide.title}`}
                  onClick={() => setActiveIndex(idx)}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === activeIndex
                      ? 'w-7 bg-teal-400'
                      : 'w-2 bg-white/40 hover:bg-white/70'
                  }`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={handlePrev}
              aria-label="Slide sebelumnya"
              className="w-8 h-8 rounded-lg bg-slate-950/50 backdrop-blur-xs border border-white/20 text-white flex items-center justify-center hover:bg-slate-950/75 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              aria-label="Slide berikutnya"
              className="w-8 h-8 rounded-lg bg-slate-950/50 backdrop-blur-xs border border-white/20 text-white flex items-center justify-center hover:bg-slate-950/75 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
