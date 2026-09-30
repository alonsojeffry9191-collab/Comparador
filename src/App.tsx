import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  Download,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  DollarSign,
  Package,
  Layers,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  Code2,
  Truck,
  Sparkles,
  ClipboardPaste,
  Info,
  Smartphone,
  HardDrive,
  Palette,
  LayoutGrid,
  Table as TableIcon,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  TrendingDown,
  Battery,
  PlusCircle,
  Trash2,
  X,
  Store,
  Percent,
  CheckCircle2
} from 'lucide-react';

interface Product {
  id: string;
  asin: string;
  title: string;
  model: string;
  capacity: string;
  color: string;
  priceUSD: number;
  url: string;
  image: string;
}

interface RateInfo {
  rate: number;
  source: string;
  lastUpdated: string;
}

interface GroupStats {
  count: number;
  minCRC: number | null;
  medianCRC: number | null;
  trimmedMeanCRC: number | null;
  insufficientData: boolean;
}

interface CRListing {
  id: string;
  sourceId: string;
  sourceName: string;
  group: 'A' | 'B' | 'C' | 'D';
  title: string;
  priceCRC: number;
  model: string;
  capacity: string;
  condition: string;
  batteryPercentage?: number | null;
  url: string;
  hasWarranty: boolean;
  warrantyDays?: number;
  isManual?: boolean;
}

export interface SourceStats extends GroupStats {
  id: string;
  name: string;
  group: 'A' | 'B' | 'C' | 'D';
  status: 'ok' | 'empty' | 'error';
  error?: string;
}

interface MarketComparisonResult {
  model: string;
  capacity: string;
  groupA: GroupStats;
  groupB: GroupStats;
  groupC?: GroupStats;
  groupD?: GroupStats;
  bySource?: Record<string, SourceStats>;
  primaryMedianCRC: number | null;
  primaryBenchmarkGroup: 'A' | 'B' | 'none';
  sourcesStatus: Record<string, { count: number; status: 'ok' | 'empty' | 'error'; error?: string }>;
  listings: CRListing[];
  timestamp: string;
}

interface CustomPriceEntry {
  id: string;
  sellerName: string;
  model: string;
  capacity: string;
  priceCRC: number;
  condition: string;
  batteryPercentage?: number;
  notes?: string;
  link?: string;
  dateAdded: string;
}

type SortField = 'price' | 'model' | 'capacity' | 'diff' | 'crMedian';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'table' | 'grid';

export default function App() {
  // Estado principal
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  // Búsqueda y parámetros
  const [searchQuery, setSearchQuery] = useState<string>('iphone');
  const [scanPages, setScanPages] = useState<number>(2);

  // Tipo de cambio
  const [exchangeRate, setExchangeRate] = useState<number>(515);
  const [rateInfo, setRateInfo] = useState<RateInfo | null>(null);
  const [manualRateInput, setManualRateInput] = useState<string>('515');
  const [isEditingRate, setIsEditingRate] = useState<boolean>(false);

  // Modo Manual (Multi-fuente)
  const [manualModeOpen, setManualModeOpen] = useState<boolean>(false);
  const [manualHtml, setManualHtml] = useState<string>('');
  const [manualSource, setManualSource] = useState<string>('amazon');
  const [manualParsing, setManualParsing] = useState<boolean>(false);

  // Costo de envío / Courier y Tarifa de Impuestos CR opcional
  const [includeShipping, setIncludeShipping] = useState<boolean>(false);
  const [shippingCostUSD, setShippingCostUSD] = useState<number>(15);
  const [includeImportTax, setIncludeImportTax] = useState<boolean>(false);
  const [importTaxPercent, setImportTaxPercent] = useState<number>(13); // IVA o arancel de importación

  // Mercado Costarricense
  const [marketCache, setMarketCache] = useState<Record<string, MarketComparisonResult>>({});
  const [marketLoadingKeys, setMarketLoadingKeys] = useState<Record<string, boolean>>({});
  const [marketLoadingAll, setMarketLoadingAll] = useState<boolean>(false);
  const [includeLowerGrades, setIncludeLowerGrades] = useState<boolean>(false);
  const [includeTiendamia, setIncludeTiendamia] = useState<boolean>(false);

  // Vendedores Manuales
  const [customSellers, setCustomSellers] = useState<CustomPriceEntry[]>([]);
  const [customSellersOpen, setCustomSellersOpen] = useState<boolean>(false);
  const [newSellerName, setNewSellerName] = useState<string>('');
  const [newSellerModel, setNewSellerModel] = useState<string>('iPhone 13');
  const [newSellerCapacity, setNewSellerCapacity] = useState<string>('128 GB');
  const [newSellerPrice, setNewSellerPrice] = useState<string>('');
  const [newSellerCondition, setNewSellerCondition] = useState<string>('Excelente');
  const [newSellerBattery, setNewSellerBattery] = useState<string>('90');
  const [newSellerNotes, setNewSellerNotes] = useState<string>('');

  // Modal de Detalle de Anuncios de Costa Rica
  const [selectedProductForModal, setSelectedProductForModal] = useState<Product | null>(null);

  // Filtros y Ordenamiento
  const [selectedModel, setSelectedModel] = useState<string>('all');
  const [selectedCapacity, setSelectedCapacity] = useState<string>('all');
  const [filterMinUSD, setFilterMinUSD] = useState<string>('');
  const [filterMaxUSD, setFilterMaxUSD] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('price');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  // Cargar tipo de cambio y vendedores manuales
  const fetchExchangeRate = async () => {
    try {
      const res = await fetch('/api/rate');
      if (res.ok) {
        const data: RateInfo = await res.json();
        setRateInfo(data);
        setExchangeRate(data.rate);
        setManualRateInput(data.rate.toString());
      }
    } catch (e) {
      console.error('Error al consultar tipo de cambio:', e);
    }
  };

  const fetchCustomSellers = async () => {
    try {
      const res = await fetch('/api/custom-prices');
      if (res.ok) {
        const data = await res.json();
        setCustomSellers(data || []);
      }
    } catch (e) {
      console.error('Error cargando vendedores manuales:', e);
    }
  };

  useEffect(() => {
    fetchExchangeRate();
    fetchCustomSellers();
    handleScan();
  }, []);

  // Helper para normalizar capacidad homogéneamente (ej: "128GB" -> "128 GB")
  const normalizeCapacity = (cap?: string): string => {
    if (!cap || cap === 'No especificado' || cap === 'all' || cap === 'N/A') return '128 GB';
    const match = cap.match(/(\d+)\s*(TB|GB)/i);
    return match ? `${match[1]} ${match[2].toUpperCase()}` : cap.trim();
  };

  // Consultar datos de mercado para un modelo y capacidad específicos
  const fetchMarketDataFor = async (model: string, rawCapacity: string, force = false): Promise<MarketComparisonResult | null> => {
    const capacity = normalizeCapacity(rawCapacity);
    const key = `${model}_${capacity}_${includeLowerGrades}_${includeTiendamia}`;
    if (!force && marketCache[key]) {
      return marketCache[key];
    }

    setMarketLoadingKeys((prev) => ({ ...prev, [key]: true }));
    try {
      const url = `/api/market?model=${encodeURIComponent(model)}&capacity=${encodeURIComponent(capacity)}&includeLowerGrades=${includeLowerGrades}&includeTiendamia=${includeTiendamia}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data: MarketComparisonResult = await res.json();
        setMarketCache((prev) => ({ ...prev, [key]: data }));
        return data;
      }
    } catch (err) {
      console.error(`Error consultando mercado CR para ${model} ${capacity}:`, err);
    } finally {
      setMarketLoadingKeys((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    return null;
  };

  // Consultar mercado para todos los modelos únicos visibles (forzando actualización si se hace clic)
  const handleFetchMarketForAll = async (items?: Product[] | unknown, force = true) => {
    const productList = Array.isArray(items) && items.length > 0 ? items : (filteredProducts.length > 0 ? filteredProducts : products);
    if (!productList || productList.length === 0) return;

    setMarketLoadingAll(true);
    const uniqueKeys = new Set<string>();
    const pairs: { model: string; capacity: string }[] = [];

    productList.forEach((p) => {
      if (p.model && p.model !== 'iPhone') {
        const normCap = normalizeCapacity(p.capacity);
        const pairKey = `${p.model}__${normCap}`;
        if (!uniqueKeys.has(pairKey)) {
          uniqueKeys.add(pairKey);
          pairs.push({ model: p.model, capacity: normCap });
        }
      }
    });

    try {
      await Promise.allSettled(
        pairs.map((pair) => fetchMarketDataFor(pair.model, pair.capacity, force))
      );
    } catch (err) {
      console.error('Error consultando mercado CR:', err);
    } finally {
      setMarketLoadingAll(false);
    }
  };

  // Normalizar productos de Amazon
  const normalizeProducts = (rawList: Product[]): Product[] => {
    return rawList.map((p) => {
      let model = p.model;
      let capacity = p.capacity;
      let color = p.color;

      // Respaldo de modelo si viene genérico
      if (!model || model === 'iPhone') {
        const cleanedTitle = p.title.replace(/\(?(?:Renewed(?:\s+Premium)?|Refurbished|Renovado)\)?/gi, ' ');
        const match = cleanedTitle.match(/\biPhone\s*(16\s*(?:Pro\s*Max|Pro|Plus|e)?|15\s*(?:Pro\s*Max|Pro|Plus)?|14\s*(?:Pro\s*Max|Pro|Plus)?|13\s*(?:Pro\s*Max|Pro|mini)?|12\s*(?:Pro\s*Max|Pro|mini)?|11\s*(?:Pro\s*Max|Pro)?|SE|XR|XS\s*Max|XS|X)\b/i);
        if (match) {
          model = `iPhone ${match[1].replace(/\s+/g, ' ').trim()}`;
        }
      }

      // Respaldo de capacidad
      if (!capacity || capacity === 'N/A' || capacity === 'No especificado') {
        const capMatch = p.title.match(/(?:\b|[([,\s-])(512|256|128|64|32|16)\s*(?:GB|G|Gb)\b/i);
        if (capMatch) {
          capacity = `${capMatch[1]} GB`;
        }
      }

      let cleanTitle = p.title;
      const hasModelInTitle = /\biPhone\s*(?:16|15|14|13|12|11|SE|XR|XS|X)\b/i.test(cleanTitle);
      if (!hasModelInTitle && model && model !== 'iPhone') {
        const capPart = capacity && capacity !== 'No especificado' ? ` (${capacity})` : '';
        const colorPart = color && color !== 'No especificado' ? ` - ${color}` : '';
        cleanTitle = `${model}${capPart}${colorPart} • ${cleanTitle.replace(/^Apple\s*(?:iPhone)?\s*[-–—,]?\s*/i, '')}`;
      }

      return {
        ...p,
        title: cleanTitle,
        model: model || 'iPhone 13',
        capacity: capacity || '128 GB',
        color: color || 'No especificado'
      };
    });
  };

  // Escaneo de Amazon
  const handleScan = async (query = searchQuery, pages = scanPages) => {
    setLoading(true);
    setError(null);
    setWarningMsg(null);

    try {
      const url = `/api/scan?q=${encodeURIComponent(query)}&pages=${pages}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Error al comunicarse con Amazon.');
        return;
      }

      const normalized = normalizeProducts(data.products || []);
      setProducts(normalized);
      if (data.warning) setWarningMsg(data.warning);
      setLastScanTime(new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      
      // Auto-precargar el comparativo de Costa Rica
      handleFetchMarketForAll(normalized);
    } catch (err: any) {
      setError(err?.message || 'Error de conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  // Procesar HTML manual (Multi-fuente)
  const handleProcessHtml = async (htmlToProcess: string, source = manualSource) => {
    if (!htmlToProcess.trim()) {
      setError('Por favor pega el código HTML en el cuadro de texto.');
      return;
    }

    setManualParsing(true);
    setError(null);
    setWarningMsg(null);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlToProcess, source })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'No se pudieron extraer datos del HTML provisto.');
        return;
      }

      if (source === 'amazon') {
        if (!data.products || data.products.length === 0) {
          setError('No se encontraron iPhones Renewed Premium en el HTML pegado.');
        } else {
          setProducts(normalizeProducts(data.products));
          setLastScanTime(new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
          setManualModeOpen(false);
          setManualHtml('');
        }
      } else {
        // Fuente de Costa Rica
        if (!data.listings || data.listings.length === 0) {
          setError(`No se encontraron productos en el HTML de ${source}.`);
        } else {
          // Invalidar caché de mercado y notificar
          setMarketCache({});
          alert(`¡Se extrajeron ${data.count} publicaciones de ${source} con éxito!`);
          setManualModeOpen(false);
          setManualHtml('');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Error al enviar el HTML para procesar.');
    } finally {
      setManualParsing(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (navigator?.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.length > 50) {
          setManualHtml(text);
          await handleProcessHtml(text, manualSource);
          return;
        }
      }
      setManualModeOpen(true);
      setError('Haz clic en el área de texto y presiona Ctrl + V para pegar el HTML.');
    } catch (_e) {
      setManualModeOpen(true);
    }
  };

  // Guardar vendedor manual
  const handleAddCustomSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSellerName || !newSellerModel || !newSellerPrice) {
      alert('Por favor completa nombre del vendedor, modelo y precio.');
      return;
    }

    try {
      const res = await fetch('/api/custom-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerName: newSellerName,
          model: newSellerModel,
          capacity: newSellerCapacity,
          priceCRC: parseInt(newSellerPrice.replace(/[^0-9]/g, ''), 10),
          condition: newSellerCondition,
          batteryPercentage: newSellerBattery ? parseInt(newSellerBattery, 10) : undefined,
          notes: newSellerNotes
        })
      });

      if (res.ok) {
        await fetchCustomSellers();
        setMarketCache({}); // Invalidar caché
        setNewSellerPrice('');
        setNewSellerNotes('');
        alert('Vendedor manual guardado con éxito. Se incluirá en el Grupo A al calcular medianas.');
      }
    } catch (err) {
      alert('Error guardando vendedor manual.');
    }
  };

  const handleDeleteCustomSeller = async (id: string) => {
    if (!confirm('¿Seguro que deseas eliminar este vendedor manual?')) return;
    try {
      const res = await fetch(`/api/custom-prices/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchCustomSellers();
        setMarketCache({});
      }
    } catch (err) {
      console.error('Error eliminando vendedor:', err);
    }
  };

  // Cálculo de costo total de Amazon en CRC (con courier e impuesto opcional)
  const calculateFinalAmazonCRC = (priceUSD: number) => {
    const courier = includeShipping ? (Number(shippingCostUSD) || 0) : 0;
    const baseWithShipping = priceUSD + courier;
    const taxMultiplier = includeImportTax ? (1 + (Number(importTaxPercent) || 0) / 100) : 1;
    const finalUSD = baseWithShipping * taxMultiplier;
    return Math.round(finalUSD * exchangeRate);
  };

  const formatCRC = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    return `₡${Math.round(val).toLocaleString('es-CR')}`;
  };

  const formatUSD = (val: number) => `$${val.toFixed(2)}`;

  // Obtener datos de mercado para un producto
  const getProductMarketData = (product: Product): MarketComparisonResult | null => {
    const normCap = normalizeCapacity(product.capacity);
    const key = `${product.model}_${normCap}_${includeLowerGrades}_${includeTiendamia}`;
    return marketCache[key] || null;
  };

  // Modelos y Capacidades únicas para filtros
  const availableModels = useMemo(() => {
    const models = new Set<string>();
    products.forEach((p) => {
      if (p.model && p.model !== 'iPhone') models.add(p.model);
    });
    return Array.from(models).sort();
  }, [products]);

  const availableCapacities = useMemo(() => {
    const caps = new Set<string>();
    products.forEach((p) => {
      if (p.capacity && p.capacity !== 'No especificado' && p.capacity !== 'N/A') {
        caps.add(p.capacity);
      }
    });
    return Array.from(caps).sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) * (a.includes('TB') ? 1024 : 1);
      const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) * (b.includes('TB') ? 1024 : 1);
      return numA - numB;
    });
  }, [products]);

  // Filtrado y Ordenamiento
  const filteredProducts = useMemo(() => {
    return products.filter((item) => {
      if (selectedModel !== 'all' && item.model !== selectedModel) return false;
      if (selectedCapacity !== 'all' && item.capacity !== selectedCapacity) return false;
      const finalUSD = item.priceUSD + (includeShipping ? (Number(shippingCostUSD) || 0) : 0);
      if (filterMinUSD && finalUSD < parseFloat(filterMinUSD)) return false;
      if (filterMaxUSD && finalUSD > parseFloat(filterMaxUSD)) return false;
      return true;
    }).sort((a, b) => {
      let comparison = 0;
      if (sortField === 'price') {
        const priceA = calculateFinalAmazonCRC(a.priceUSD);
        const priceB = calculateFinalAmazonCRC(b.priceUSD);
        comparison = priceA - priceB;
      } else if (sortField === 'model') {
        comparison = a.model.localeCompare(b.model);
      } else if (sortField === 'capacity') {
        const numA = parseInt(a.capacity.replace(/[^0-9]/g, '') || '0', 10) * (a.capacity.includes('TB') ? 1024 : 1);
        const numB = parseInt(b.capacity.replace(/[^0-9]/g, '') || '0', 10) * (b.capacity.includes('TB') ? 1024 : 1);
        comparison = numA - numB;
      } else if (sortField === 'crMedian') {
        const dataA = getProductMarketData(a);
        const dataB = getProductMarketData(b);
        const medA = dataA?.primaryMedianCRC || 0;
        const medB = dataB?.primaryMedianCRC || 0;
        comparison = medA - medB;
      } else if (sortField === 'diff') {
        const dataA = getProductMarketData(a);
        const dataB = getProductMarketData(b);
        const diffA = dataA?.primaryMedianCRC ? (dataA.primaryMedianCRC - calculateFinalAmazonCRC(a.priceUSD)) : -999999;
        const diffB = dataB?.primaryMedianCRC ? (dataB.primaryMedianCRC - calculateFinalAmazonCRC(b.priceUSD)) : -999999;
        comparison = diffA - diffB;
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [products, selectedModel, selectedCapacity, filterMinUSD, filterMaxUSD, sortField, sortDir, includeShipping, shippingCostUSD, includeImportTax, importTaxPercent, marketCache, exchangeRate]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Exportar a CSV con datos de mercado y diferencias
  const handleExportCSV = () => {
    if (filteredProducts.length === 0) return;

    const headers = [
      'ASIN',
      'Modelo',
      'Almacenamiento',
      'Color',
      'Precio Amazon (USD)',
      'Envio Courier (USD)',
      'Impuesto Importacion (%)',
      'Costo Total Amazon (CRC)',
      'Mediana CR Grupo A - Garantia (CRC)',
      'Anuncios Grupo A',
      'Promedio Recortado Grupo A (CRC)',
      'Mediana CR Grupo B - Marketplaces (CRC)',
      'Anuncios Grupo B',
      'Benchmark Utilizado',
      'Diferencia en Colones (CRC)',
      'Diferencia en Porcentaje (%)',
      'Veredicto',
      'Titulo Amazon',
      'Enlace Amazon'
    ];

    const rows = filteredProducts.map((p) => {
      const amazonCRC = calculateFinalAmazonCRC(p.priceUSD);
      const market = getProductMarketData(p);
      const medA = market?.groupA?.medianCRC ?? '';
      const countA = market?.groupA?.count ?? 0;
      const trimA = market?.groupA?.trimmedMeanCRC ?? '';
      const medB = market?.groupB?.medianCRC ?? '';
      const countB = market?.groupB?.count ?? 0;

      let benchmark = 'Ninguno';
      let diffCRC: number | string = '';
      let diffPct: number | string = '';
      let veredicto = 'Sin datos CR';

      if (market?.primaryMedianCRC) {
        benchmark = market.primaryBenchmarkGroup === 'A' ? 'Grupo A (Garantía)' : 'Grupo B (Marketplaces)';
        const diff = market.primaryMedianCRC - amazonCRC;
        diffCRC = diff;
        diffPct = ((diff / market.primaryMedianCRC) * 100).toFixed(1) + '%';
        veredicto = diff > 0 ? 'Conviene importar' : 'Comprar en CR';
      }

      return [
        `"${p.asin || ''}"`,
        `"${p.model}"`,
        `"${p.capacity}"`,
        `"${p.color}"`,
        p.priceUSD.toFixed(2),
        includeShipping ? shippingCostUSD : 0,
        includeImportTax ? `${importTaxPercent}%` : '0%',
        amazonCRC,
        medA,
        countA,
        trimA,
        medB,
        countB,
        `"${benchmark}"`,
        diffCRC,
        `"${diffPct}"`,
        `"${veredicto}"`,
        `"${p.title.replace(/"/g, '""')}"`,
        `"${p.url}"`
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `iphones_amazon_vs_costa_rica_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-16">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-md shadow-emerald-500/20 font-bold text-xl">
              
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  iPhone Renewed vs. Mercado Costa Rica
                </h1>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-3 h-3" /> Comparador en CRC
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Amazon Renewed Premium vs. Tiendas con garantía y Marketplaces locales
              </p>
            </div>
          </div>

          {/* Widget Tipo de Cambio y Acciones */}
          <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
            <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/70 rounded-xl px-3 py-1.5 text-xs shadow-inner">
              <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-slate-300">1 USD =</span>
              {isEditingRate ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.1"
                    value={manualRateInput}
                    onChange={(e) => setManualRateInput(e.target.value)}
                    className="w-20 bg-slate-900 border border-emerald-500 text-white font-mono text-xs rounded px-1.5 py-0.5 focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      const val = parseFloat(manualRateInput);
                      if (!isNaN(val) && val > 0) {
                        setExchangeRate(val);
                        setIsEditingRate(false);
                      }
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-2 py-0.5 rounded transition text-[11px]"
                  >
                    Fijar
                  </button>
                </div>
              ) : (
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  ₡{exchangeRate.toFixed(2)}
                </span>
              )}
              <button
                onClick={() => setIsEditingRate(!isEditingRate)}
                className="text-slate-400 hover:text-slate-200 underline text-[11px] ml-1"
              >
                {isEditingRate ? 'Cancelar' : 'Editar'}
              </button>
              <button
                onClick={fetchExchangeRate}
                title="Actualizar tasa"
                className="text-slate-400 hover:text-emerald-400 transition ml-0.5 p-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={() => setCustomSellersOpen(true)}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 font-medium transition cursor-pointer"
            >
              <Store className="w-3.5 h-3.5 text-sky-400" />
              <span>Vendedores Manuales ({customSellers.length})</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Panel de Controles y Parámetros */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                placeholder="Buscar modelo (ej: iphone 15 pro, iphone 14, iphone 13)..."
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              />
            </div>

            <div className="flex items-center gap-2 bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400 whitespace-nowrap">Páginas:</span>
              <select
                value={scanPages}
                onChange={(e) => setScanPages(Number(e.target.value))}
                className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
              >
                <option value={1} className="bg-slate-900">1 pág (~16)</option>
                <option value={2} className="bg-slate-900">2 págs (~32)</option>
                <option value={3} className="bg-slate-900">3 págs (~48)</option>
              </select>
            </div>

            <button
              onClick={() => handleScan()}
              disabled={loading}
              className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Consultando Amazon...' : 'Escanear Amazon'}</span>
            </button>

            <button
              onClick={() => handleFetchMarketForAll(filteredProducts, true)}
              disabled={marketLoadingAll || products.length === 0}
              className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-sky-600/20 transition cursor-pointer text-xs"
              title="Consulta tiendas locales de Costa Rica para todos los modelos (excluye teléfonos nuevos)"
            >
              <ShieldCheck className={`w-4 h-4 ${marketLoadingAll ? 'animate-spin' : ''}`} />
              <span>{marketLoadingAll ? 'Consultando CR...' : 'Consultar Mercado CR'}</span>
            </button>
          </div>

          {/* Ajustes de Courier, Impuestos y Criterios de Mercado */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/60 text-xs">
            {/* Courier e Impuesto CR */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Courier */}
              <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-1.5">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeShipping}
                    onChange={(e) => setIncludeShipping(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-900"
                  />
                  <Truck className="w-3.5 h-3.5 text-slate-400" />
                  <span>Courier / Envío:</span>
                </label>
                {includeShipping && (
                  <div className="flex items-center gap-1 font-mono">
                    <span className="text-slate-400">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={shippingCostUSD}
                      onChange={(e) => setShippingCostUSD(Number(e.target.value))}
                      className="w-12 bg-slate-900 border border-slate-700 text-white rounded px-1 text-xs text-center focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400">USD</span>
                  </div>
                )}
              </div>

              {/* Impuesto Importación CR */}
              <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-1.5">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeImportTax}
                    onChange={(e) => setIncludeImportTax(e.target.checked)}
                    className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900"
                  />
                  <Percent className="w-3.5 h-3.5 text-amber-400" />
                  <span>Impuestos Importación CR:</span>
                </label>
                {includeImportTax && (
                  <div className="flex items-center gap-1 font-mono">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={importTaxPercent}
                      onChange={(e) => setImportTaxPercent(Number(e.target.value))}
                      className="w-12 bg-slate-900 border border-slate-700 text-white rounded px-1 text-xs text-center focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400">%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Opciones de Filtro de Mercado Costa Rica */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-400 hover:text-slate-200">
                <input
                  type="checkbox"
                  checked={includeLowerGrades}
                  onChange={(e) => {
                    setIncludeLowerGrades(e.target.checked);
                    setMarketCache({});
                  }}
                  className="rounded border-slate-700 text-sky-500 focus:ring-sky-500"
                />
                <span>Incluir estados inferiores en Grupo A</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-400 hover:text-slate-200">
                <input
                  type="checkbox"
                  checked={includeTiendamia}
                  onChange={(e) => {
                    setIncludeTiendamia(e.target.checked);
                    setMarketCache({});
                  }}
                  className="rounded border-slate-700 text-amber-500 focus:ring-amber-500"
                />
                <span>Incluir Tiendamia en Marketplaces</span>
              </label>
            </div>

            {/* Banner Informativo: Comparativa Exclusiva de Usados */}
            <div className="w-full flex items-center gap-2.5 bg-emerald-950/60 border border-emerald-700/60 rounded-xl px-3.5 py-2 text-xs text-emerald-200 shadow-inner">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <strong>Comparación Exclusiva con Teléfonos Usados:</strong> Todos los precios de referencia de Costa Rica excluyen estrictamente teléfonos nuevos o sellados. Se comparan únicamente seminuevos con garantía de tiendas locales (Grupo A) y anuncios de segunda mano verificados (Grupo B).
              </span>
            </div>
          </div>
        </div>

        {/* Panel Plegable Modo Manual (Multi-Fuente) */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden transition-all">
          <button
            onClick={() => setManualModeOpen(!manualModeOpen)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-800/40 transition cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <Code2 className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-200">
                  Modo Manual / Pegar HTML (Amazon o Tiendas de Costa Rica)
                </span>
                <span className="text-xs text-slate-400 block sm:inline sm:ml-2">
                  — Pega el código fuente si alguna fuente bloquea la IP en la nube
                </span>
              </div>
            </div>
            <div className="text-slate-400">
              {manualModeOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {manualModeOpen && (
            <div className="p-5 border-t border-slate-800 bg-slate-950/70 space-y-4">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-300 font-medium">Selecciona la fuente del código HTML:</span>
                <select
                  value={manualSource}
                  onChange={(e) => setManualSource(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-white rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500 font-medium"
                >
                  <option value="amazon">Amazon USA (Renewed Premium)</option>
                  <option value="nuvo">NUVO Store Costa Rica</option>
                  <option value="istuff">iStuff Costa Rica</option>
                  <option value="linocr">Linocr Costa Rica</option>
                  <option value="mercadolibre_cr">Mercado Libre Costa Rica</option>
                  <option value="encuentra24">Encuentra24 Costa Rica</option>
                  <option value="tiendacelular">Tienda Celular CR</option>
                  <option value="tiendamia_cr">Tiendamia CR</option>
                  <option value="innovacell_cr">InnovaCell CR (Nuevo)</option>
                  <option value="celularescostarica_cr">Celulares Costa Rica (Nuevo)</option>
                </select>
              </div>

              <textarea
                value={manualHtml}
                onChange={(e) => setManualHtml(e.target.value)}
                placeholder="Pega el código HTML completo aquí (Ctrl + U en la página de resultados)..."
                rows={5}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={handlePasteFromClipboard}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Pegar desde Portapapeles</span>
                </button>

                <div className="flex gap-2">
                  {manualHtml && (
                    <button
                      onClick={() => setManualHtml('')}
                      className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-400 hover:text-white"
                    >
                      Limpiar
                    </button>
                  )}
                  <button
                    onClick={() => handleProcessHtml(manualHtml, manualSource)}
                    disabled={manualParsing || !manualHtml.trim()}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{manualParsing ? 'Procesando...' : 'Procesar HTML'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal/Drawer de Vendedores Manuales */}
        {customSellersOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Store className="w-5 h-5 text-sky-400" />
                  <h3 className="font-bold text-base text-white">Vendedores Manuales (TikTok, Instagram, etc.)</h3>
                </div>
                <button onClick={() => setCustomSellersOpen(false)} className="text-slate-400 hover:text-white p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Formulario nuevo vendedor */}
              <form onSubmit={handleAddCustomSeller} className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
                <h4 className="font-semibold text-slate-200">Registrar nuevo vendedor o anuncio local</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 block mb-1">Vendedor / Tienda</label>
                    <input
                      type="text"
                      placeholder="Ej: iStore CR / TikTok @celularescr"
                      value={newSellerName}
                      onChange={(e) => setNewSellerName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Precio en Colones (₡)</label>
                    <input
                      type="number"
                      placeholder="Ej: 280000"
                      value={newSellerPrice}
                      onChange={(e) => setNewSellerPrice(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Modelo</label>
                    <select
                      value={newSellerModel}
                      onChange={(e) => setNewSellerModel(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                    >
                      <option value="iPhone 15 Pro Max">iPhone 15 Pro Max</option>
                      <option value="iPhone 15 Pro">iPhone 15 Pro</option>
                      <option value="iPhone 15">iPhone 15</option>
                      <option value="iPhone 14 Pro Max">iPhone 14 Pro Max</option>
                      <option value="iPhone 14 Pro">iPhone 14 Pro</option>
                      <option value="iPhone 14">iPhone 14</option>
                      <option value="iPhone 13 Pro Max">iPhone 13 Pro Max</option>
                      <option value="iPhone 13 Pro">iPhone 13 Pro</option>
                      <option value="iPhone 13">iPhone 13</option>
                      <option value="iPhone 13 mini">iPhone 13 mini</option>
                      <option value="iPhone 12 Pro">iPhone 12 Pro</option>
                      <option value="iPhone 12">iPhone 12</option>
                      <option value="iPhone 11">iPhone 11</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Almacenamiento</label>
                    <select
                      value={newSellerCapacity}
                      onChange={(e) => setNewSellerCapacity(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                    >
                      <option value="128 GB">128 GB</option>
                      <option value="256 GB">256 GB</option>
                      <option value="512 GB">512 GB</option>
                      <option value="64 GB">64 GB</option>
                      <option value="1 TB">1 TB</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Condición</label>
                    <select
                      value={newSellerCondition}
                      onChange={(e) => setNewSellerCondition(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                    >
                      <option value="Excelente">Excelente (Como nuevo)</option>
                      <option value="Muy Bueno">Muy Bueno</option>
                      <option value="Bueno">Bueno</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">% Batería (opcional)</label>
                    <input
                      type="number"
                      min="50"
                      max="100"
                      placeholder="Ej: 88"
                      value={newSellerBattery}
                      onChange={(e) => setNewSellerBattery(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Notas / Enlace / Garantía</label>
                  <input
                    type="text"
                    placeholder="Ej: Garantía 30 días, incluye cargador, link de post"
                    value={newSellerNotes}
                    onChange={(e) => setNewSellerNotes(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                  />
                </div>

                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Guardar Vendedor Manual</span>
                </button>
              </form>

              {/* Lista de vendedores registrados */}
              <div className="space-y-2">
                <h4 className="font-semibold text-xs text-slate-400 uppercase tracking-wider">
                  Vendedores guardados ({customSellers.length})
                </h4>
                {customSellers.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No hay vendedores manuales registrados.</p>
                ) : (
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden text-xs">
                    {customSellers.map((cs) => (
                      <div key={cs.id} className="p-3 bg-slate-900/50 flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{cs.sellerName}</span>
                            <span className="bg-sky-950 text-sky-400 border border-sky-800 px-1.5 py-0.2 rounded font-semibold text-[10px]">
                              {cs.model} • {cs.capacity}
                            </span>
                            <span className="text-emerald-400 font-mono font-bold text-sm">
                              {formatCRC(cs.priceCRC)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-400 text-[11px] mt-0.5">
                            <span>Estado: {cs.condition}</span>
                            {cs.batteryPercentage && <span>• Batería: {cs.batteryPercentage}%</span>}
                            {cs.notes && <span>• {cs.notes}</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteCustomSeller(cs.id)}
                          className="text-slate-500 hover:text-red-400 p-1.5 transition"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal de Detalle de Anuncios de Costa Rica */}
        {selectedProductForModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col p-6 shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-lg text-white flex items-center gap-2">
                    <span>📱 Mercado Costa Rica: {selectedProductForModal.model} ({selectedProductForModal.capacity})</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Anuncios y tiendas locales usadas para calcular la mediana y el promedio recortado
                  </p>
                </div>
                <button onClick={() => setSelectedProductForModal(null)} className="text-slate-400 hover:text-white p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Estadísticas comparativas rápidas y desglose por fuente */}
              {(() => {
                const market = getProductMarketData(selectedProductForModal);
                const amazonCost = calculateFinalAmazonCRC(selectedProductForModal.priceUSD);
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-slate-400 block text-[11px]">Costo Amazon CRC</span>
                        <span className="font-bold text-white font-mono text-sm">{formatCRC(amazonCost)}</span>
                      </div>
                      <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-sky-400 block text-[11px]">Mediana Grupo A (Usados Garantía)</span>
                        <span className="font-bold text-sky-300 font-mono text-sm">
                          {market?.groupA?.insufficientData ? 'Datos insuficientes' : formatCRC(market?.groupA?.medianCRC)}
                        </span>
                      </div>
                      <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-purple-400 block text-[11px]">Mediana Grupo B (Marketplaces Usados)</span>
                        <span className="font-bold text-purple-300 font-mono text-sm">
                          {market?.groupB?.insufficientData ? 'Datos insuficientes' : formatCRC(market?.groupB?.medianCRC)}
                        </span>
                      </div>
                      <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-slate-400 block text-[11px]">Diferencia estimada</span>
                        {market?.primaryMedianCRC ? (
                          <span className={`font-bold font-mono text-sm ${market.primaryMedianCRC - amazonCost > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {market.primaryMedianCRC - amazonCost > 0 ? '+' : ''}{formatCRC(market.primaryMedianCRC - amazonCost)}
                          </span>
                        ) : (
                          <span className="text-slate-500 font-mono text-sm">—</span>
                        )}
                      </div>
                    </div>

                    {market?.bySource && Object.keys(market.bySource).length > 0 && (
                      <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-2">
                        <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                          Estadísticas por Fuente (Mínimo, Mediana y Promedio Recortado 10%)
                        </span>
                        <div className="overflow-x-auto max-h-40 overflow-y-auto">
                          <table className="w-full text-[11px] text-left">
                            <thead>
                              <tr className="text-slate-400 border-b border-slate-800 sticky top-0 bg-slate-950">
                                <th className="pb-1">Fuente</th>
                                <th className="pb-1 text-center">Grupo</th>
                                <th className="pb-1 text-center">Anuncios</th>
                                <th className="pb-1 text-right">Mínimo</th>
                                <th className="pb-1 text-right">Mediana</th>
                                <th className="pb-1 text-right">Prom. Recortado</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/40 font-mono">
                              {Object.values(market.bySource).map((src) => (
                                <tr key={src.id} className="text-slate-300 hover:bg-slate-800/30">
                                  <td className="py-1 font-sans font-medium text-slate-200">{src.name}</td>
                                  <td className="py-1 text-center">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      src.group === 'A' ? 'bg-sky-950 text-sky-300 border border-sky-800' :
                                      src.group === 'B' ? 'bg-purple-950 text-purple-300 border border-purple-800' :
                                      src.group === 'C' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                                      'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                    }`}>
                                      {src.group === 'A' ? 'Grupo A (Garantía)' : src.group === 'B' ? 'Grupo B (Market)' : src.group === 'C' ? 'Grupo C (Amazon)' : 'Grupo D (Nuevo)'}
                                    </span>
                                  </td>
                                  <td className="py-1 text-center">{src.count}</td>
                                  <td className="py-1 text-right text-emerald-400">{src.minCRC ? formatCRC(src.minCRC) : '—'}</td>
                                  <td className="py-1 text-right text-sky-300 font-bold">{src.medianCRC ? formatCRC(src.medianCRC) : '—'}</td>
                                  <td className="py-1 text-right text-slate-400">{src.trimmedMeanCRC ? formatCRC(src.trimmedMeanCRC) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Listado de publicaciones individuales */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {(() => {
                  const normCap = normalizeCapacity(selectedProductForModal.capacity);
                  const modalKey = `${selectedProductForModal.model}_${normCap}_${includeLowerGrades}_${includeTiendamia}`;
                  const isModalLoading = Boolean(marketLoadingKeys[modalKey]);
                  const market = getProductMarketData(selectedProductForModal);

                  if (isModalLoading) {
                    return (
                      <div className="text-center py-12 space-y-3">
                        <RefreshCw className="w-8 h-8 text-sky-400 animate-spin mx-auto" />
                        <p className="text-sm font-semibold text-slate-200">
                          Consultando NUVO, iStuff, Linocr y Mercado Libre...
                        </p>
                        <p className="text-xs text-slate-400">Extrayendo precios actuales y garantías en Costa Rica</p>
                      </div>
                    );
                  }

                  if (!market) {
                    return (
                      <div className="text-center py-10 space-y-3">
                        <Package className="w-8 h-8 text-slate-600 mx-auto" />
                        <p className="text-slate-400 text-xs">Aún no se han consultado los datos de mercado para este modelo.</p>
                        <button
                          onClick={() => fetchMarketDataFor(selectedProductForModal.model, selectedProductForModal.capacity, true)}
                          className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-4 py-2 rounded-xl text-xs flex items-center justify-center gap-2 mx-auto cursor-pointer shadow-lg shadow-sky-600/20"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          <span>Consultar tiendas de Costa Rica ahora</span>
                        </button>
                      </div>
                    );
                  }

                  if (market.listings.length === 0) {
                    return (
                      <div className="text-center py-10 space-y-3">
                        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
                        <p className="text-slate-300 text-xs font-semibold">
                          Consulta completada: no se encontraron anuncios activos para {selectedProductForModal.model} ({selectedProductForModal.capacity}).
                        </p>
                        <button
                          onClick={() => fetchMarketDataFor(selectedProductForModal.model, selectedProductForModal.capacity, true)}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-3 py-1.5 rounded-xl text-xs flex items-center justify-center gap-2 mx-auto cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Reintentar consulta</span>
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-slate-400 block">
                        {market.listings.length} publicaciones encontradas en Costa Rica:
                      </span>
                      {market.listings.map((item) => (
                        <div
                          key={item.id}
                          className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 flex items-center justify-between gap-3 text-xs hover:border-slate-700 transition"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.group === 'A'
                                  ? 'bg-sky-950 text-sky-300 border border-sky-800'
                                  : 'bg-purple-950 text-purple-300 border border-purple-800'
                              }`}>
                                {item.sourceName} ({item.group === 'A' ? 'Garantía' : 'Marketplace'})
                              </span>
                              <span className="bg-slate-800 text-slate-300 px-1.5 py-0.2 rounded text-[10px]">
                                {item.condition}
                              </span>
                              {item.batteryPercentage && (
                                <span className="inline-flex items-center gap-0.5 text-emerald-400 text-[10px] font-mono">
                                  <Battery className="w-3 h-3" /> {item.batteryPercentage}%
                                </span>
                              )}
                              {item.hasWarranty && (
                                <span className="text-amber-400 text-[10px]">
                                  🛡️ {item.warrantyDays || 90} días garantía
                                </span>
                              )}
                            </div>
                            <p className="text-slate-200 mt-1 font-medium truncate" title={item.title}>
                              {item.title}
                            </p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-extrabold text-base font-mono text-emerald-400">
                              {formatCRC(item.priceCRC)}
                            </span>
                            {item.url && item.url !== '#' && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1.5 rounded-lg border border-slate-700 transition"
                                title="Ver publicación original"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Filtros, Vistas y Exportación */}
        <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 space-y-3">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <div className="flex items-center gap-1.5 text-slate-400">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-medium">Filtrar:</span>
              </div>

              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-semibold focus:outline-none"
              >
                <option value="all">📱 Todos los modelos ({products.length})</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m} ({products.filter((p) => p.model === m).length})
                  </option>
                ))}
              </select>

              <select
                value={selectedCapacity}
                onChange={(e) => setSelectedCapacity(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-semibold focus:outline-none"
              >
                <option value="all">💾 Toda capacidad</option>
                {availableCapacities.map((c) => (
                  <option key={c} value={c}>
                    {c} ({products.filter((p) => p.capacity === c).length})
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
                <span className="text-slate-400 text-[11px]">$</span>
                <input
                  type="number"
                  placeholder="Min"
                  value={filterMinUSD}
                  onChange={(e) => setFilterMinUSD(e.target.value)}
                  className="w-14 bg-transparent text-white text-xs focus:outline-none"
                />
                <span className="text-slate-500">-</span>
                <span className="text-slate-400 text-[11px]">$</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filterMaxUSD}
                  onChange={(e) => setFilterMaxUSD(e.target.value)}
                  className="w-14 bg-transparent text-white text-xs focus:outline-none"
                />
              </div>

              {(selectedModel !== 'all' || selectedCapacity !== 'all' || filterMinUSD || filterMaxUSD) && (
                <button
                  onClick={() => {
                    setSelectedModel('all');
                    setSelectedCapacity('all');
                    setFilterMinUSD('');
                    setFilterMaxUSD('');
                  }}
                  className="text-emerald-400 hover:underline text-[11px]"
                >
                  Restablecer
                </button>
              )}
            </div>

            <div className="flex items-center justify-between lg:justify-end gap-3 text-xs">
              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition font-medium ${
                    viewMode === 'table' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <TableIcon className="w-3.5 h-3.5" />
                  <span>Tabla Comparativa</span>
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition font-medium ${
                    viewMode === 'grid' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Tarjetas</span>
                </button>
              </div>

              <button
                onClick={handleExportCSV}
                disabled={filteredProducts.length === 0}
                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-medium transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Exportar CSV Completo</span>
              </button>
            </div>
          </div>
        </div>

        {/* TABLA PRINCIPAL COMPARATIVA (Amazon vs. Costa Rica) */}
        {loading ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
            <p className="text-base font-semibold text-slate-200">Consultando Amazon Renewed Premium...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
            <Package className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-base font-semibold text-slate-300">No se encontraron productos</h3>
          </div>
        ) : viewMode === 'table' ? (
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400 select-none">
                    <th className="py-3 px-3 w-14 text-center">Foto</th>
                    <th className="py-3 px-4 min-w-[220px]">📱 Modelo & Capacidad</th>
                    <th
                      onClick={() => toggleSort('price')}
                      className="py-3 px-4 cursor-pointer hover:text-white transition text-right whitespace-nowrap"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Costo Amazon (CRC)</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-500" />
                      </div>
                    </th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex flex-col items-end">
                        <span className="text-sky-300 font-bold">Mediana CR (Grupo A)</span>
                        <span className="text-[10px] text-slate-400 font-normal">Usados con Garantía</span>
                      </div>
                    </th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex flex-col items-end">
                        <span className="text-purple-300 font-bold">Mediana CR (Grupo B)</span>
                        <span className="text-[10px] text-slate-400 font-normal">Marketplaces Usados</span>
                      </div>
                    </th>
                    <th
                      onClick={() => toggleSort('diff')}
                      className="py-3 px-4 cursor-pointer hover:text-white transition text-right whitespace-nowrap"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Diferencia vs. CR</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-500" />
                      </div>
                    </th>
                    <th className="py-3 px-4 text-center w-28">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {filteredProducts.map((product) => {
                    const amazonCRC = calculateFinalAmazonCRC(product.priceUSD);
                    const market = getProductMarketData(product);
                    const normCap = normalizeCapacity(product.capacity);
                    const productKey = `${product.model}_${normCap}_${includeLowerGrades}_${includeTiendamia}`;
                    const isLoadingMarket = Boolean(marketLoadingKeys[productKey]) || (marketLoadingAll && !market);

                    // Calcular diferencia contra Grupo A; si Grupo A tiene datos insuficientes, contra Grupo B
                    let diffAmount: number | null = null;
                    let diffPercent: number | null = null;
                    let benchmarkUsed: 'A' | 'B' | 'none' = 'none';

                    if (market?.groupA && !market.groupA.insufficientData && market.groupA.medianCRC) {
                      diffAmount = market.groupA.medianCRC - amazonCRC;
                      diffPercent = (diffAmount / market.groupA.medianCRC) * 100;
                      benchmarkUsed = 'A';
                    } else if (market?.groupB && !market.groupB.insufficientData && market.groupB.medianCRC) {
                      diffAmount = market.groupB.medianCRC - amazonCRC;
                      diffPercent = (diffAmount / market.groupB.medianCRC) * 100;
                      benchmarkUsed = 'B';
                    }

                    const isFavorable = diffAmount !== null && diffAmount > 0;

                    return (
                      <tr key={product.id} className="hover:bg-slate-800/40 transition group">
                        {/* Foto */}
                        <td className="py-3 px-3 text-center">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.model}
                              className="w-12 h-12 object-contain bg-slate-950 rounded-lg p-1 mx-auto border border-slate-800"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500 mx-auto text-xs">
                              
                            </div>
                          )}
                        </td>

                        {/* Modelo y Capacidad */}
                        <td className="py-3 px-4">
                          <a
                            href={product.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block group/link"
                            title={product.title}
                          >
                            <div className="font-extrabold text-sm sm:text-base text-white group-hover/link:text-emerald-400 transition flex items-center gap-1.5 flex-wrap">
                              <span>{product.model}</span>
                              {product.capacity && product.capacity !== 'No especificado' && (
                                <span className="text-purple-300 bg-purple-950/90 border border-purple-600/70 font-mono text-xs px-2 py-0.5 rounded font-bold shadow-sm">
                                  {product.capacity}
                                </span>
                              )}
                              {product.color && product.color !== 'No especificado' && (
                                <span className="text-amber-300/90 text-xs font-normal">
                                  • {product.color}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 group-hover/link:text-slate-300 line-clamp-1 mt-1 leading-snug">
                              {product.title}
                            </p>
                          </a>
                        </td>

                        {/* Costo Amazon CRC */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <span className="font-extrabold text-base font-mono text-emerald-400 tracking-tight block">
                            {formatCRC(amazonCRC)}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">
                            ${product.priceUSD.toFixed(2)}
                            {includeShipping && <span className="text-teal-400 ml-1">(+$15)</span>}
                            {includeImportTax && <span className="text-amber-400 ml-1">(+{importTaxPercent}%)</span>}
                          </span>
                        </td>

                        {/* Mediana Grupo A (Garantía) */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {isLoadingMarket || (marketLoadingAll && !market) ? (
                            <span className="text-xs text-sky-400 animate-pulse font-mono flex items-center justify-end gap-1">
                              <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                              <span>Consultando...</span>
                            </span>
                          ) : !market ? (
                            <button
                              onClick={() => fetchMarketDataFor(product.model, product.capacity, true)}
                              className="text-xs text-sky-400 hover:underline cursor-pointer"
                            >
                              Comparar CR
                            </button>
                          ) : market.groupA?.insufficientData ? (
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-slate-400 italic">datos insuficientes</span>
                              <span className="text-[10px] text-slate-400">({market.groupA.count} anuncios)</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end">
                              <span className="font-bold text-sm font-mono text-sky-300">
                                {formatCRC(market.groupA.medianCRC)}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                ({market.groupA.count} anuncios) • Recort: {formatCRC(market.groupA.trimmedMeanCRC)}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Mediana Grupo B (Marketplaces) */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {isLoadingMarket || (marketLoadingAll && !market) ? (
                            <span className="text-xs text-purple-400 animate-pulse font-mono flex items-center justify-end gap-1">
                              <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                              <span>...</span>
                            </span>
                          ) : !market ? (
                            <span className="text-xs text-slate-600">—</span>
                          ) : market.groupB?.insufficientData ? (
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-slate-400 italic">datos insuficientes</span>
                              <span className="text-[10px] text-slate-400">({market.groupB.count} anuncios)</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end">
                              <span className="font-bold text-sm font-mono text-purple-300">
                                {formatCRC(market.groupB.medianCRC)}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                ({market.groupB.count} anuncios)
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Diferencia vs. Mercado CR */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {diffAmount !== null ? (
                            <div className="flex flex-col items-end">
                              <div className={`flex items-center gap-1 font-extrabold text-sm font-mono ${isFavorable ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isFavorable ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                <span>{isFavorable ? '+' : ''}{formatCRC(diffAmount)}</span>
                              </div>
                              <div className="flex items-center gap-1 text-[11px]">
                                <span className={`font-semibold font-mono ${isFavorable ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {isFavorable ? 'Ahorras ' : 'Pierdes '}{Math.abs(diffPercent!).toFixed(1)}%
                                </span>
                                {benchmarkUsed === 'B' && (
                                  <span className="bg-purple-950 text-purple-300 text-[9px] px-1 rounded" title="Calculado contra Grupo B por falta de datos en Grupo A">
                                    vs Grupo B
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>

                        {/* Acciones */}
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => {
                                setSelectedProductForModal(product);
                                if (!market) fetchMarketDataFor(product.model, product.capacity);
                              }}
                              className="bg-slate-800 hover:bg-sky-600 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold transition border border-slate-700"
                              title="Ver anuncios individuales de Costa Rica"
                            >
                              Ver CR {market ? `(${market.listings.length})` : ''}
                            </button>
                            <a
                              href={product.url}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white p-1.5 rounded-lg border border-slate-700 transition"
                              title="Ver en Amazon"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* VISTA EN TARJETAS */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map((product) => {
              const amazonCRC = calculateFinalAmazonCRC(product.priceUSD);
              const market = getProductMarketData(product);

              let diffAmount: number | null = null;
              let diffPercent: number | null = null;
              if (market?.groupA && !market.groupA.insufficientData && market.groupA.medianCRC) {
                diffAmount = market.groupA.medianCRC - amazonCRC;
                diffPercent = (diffAmount / market.groupA.medianCRC) * 100;
              } else if (market?.groupB && !market.groupB.insufficientData && market.groupB.medianCRC) {
                diffAmount = market.groupB.medianCRC - amazonCRC;
                diffPercent = (diffAmount / market.groupB.medianCRC) * 100;
              }

              return (
                <div key={product.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-4 shadow-lg hover:border-slate-700 transition">
                  <div>
                    <div className="flex items-start gap-3">
                      <div className="w-16 h-16 bg-slate-950 rounded-xl p-1.5 border border-slate-800 flex items-center justify-center shrink-0">
                        {product.image ? (
                          <img src={product.image} alt={product.model} className="w-full h-full object-contain" />
                        ) : (
                          <span className="text-xl"></span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-base font-extrabold text-white">{product.model}</span>
                          <span className="bg-purple-950 text-purple-300 border border-purple-700 font-mono text-xs px-2 py-0.5 rounded font-bold">
                            {product.capacity}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-1 mt-1">{product.title}</p>
                      </div>
                    </div>

                    {/* Comparativo de Precios en Tarjeta */}
                    <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Costo Amazon</span>
                        <span className="font-extrabold text-emerald-400 font-mono text-sm">{formatCRC(amazonCRC)}</span>
                        <span className="text-[10px] text-slate-500 block">USD ${product.priceUSD.toFixed(2)}</span>
                      </div>
                      <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                        <span className="text-sky-400 block text-[10px]">Mediana Costa Rica</span>
                        <span className="font-extrabold text-sky-300 font-mono text-sm">
                          {market?.primaryMedianCRC ? formatCRC(market.primaryMedianCRC) : 'Sin datos'}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          {market?.groupA && !market.groupA.insufficientData ? 'Grupo A (Garantía)' : 'Grupo B'}
                        </span>
                      </div>
                    </div>

                    {diffAmount !== null && (
                      <div className={`mt-2 p-2 rounded-xl text-xs font-semibold flex items-center justify-between ${diffAmount > 0 ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50' : 'bg-red-950/40 text-red-300 border border-red-800/50'}`}>
                        <span>{diffAmount > 0 ? 'Conviene importar (ahorro):' : 'Más caro que comprar en CR:'}</span>
                        <span className="font-mono font-bold">{diffAmount > 0 ? '+' : ''}{formatCRC(diffAmount)} ({diffPercent?.toFixed(1)}%)</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/60">
                    <button
                      onClick={() => {
                        setSelectedProductForModal(product);
                        if (!market) fetchMarketDataFor(product.model, product.capacity);
                      }}
                      className="flex-1 bg-slate-800 hover:bg-sky-600 text-slate-200 hover:text-white py-2 rounded-xl text-xs font-semibold transition"
                    >
                      Ver mercado CR {market ? `(${market.listings.length})` : ''}
                    </button>
                    <a
                      href={product.url}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white p-2 rounded-xl text-xs font-semibold transition"
                      title="Ver en Amazon"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <footer className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 border-t border-slate-800/80 pt-4 px-1">
          <div className="flex items-center gap-4 flex-wrap">
            {lastScanTime && (
              <span>
                Última consulta: <strong className="text-slate-300">{lastScanTime}</strong>
              </span>
            )}
            <span>
              Tipo de cambio: <strong className="text-emerald-400">₡{exchangeRate}</strong>
              {rateInfo?.source && <span className="text-slate-500 ml-1">({rateInfo.source})</span>}
            </span>
          </div>
          <div className="text-slate-400 text-right">
            Mediana y promedio recortado (10%) • Filtro de precios absurdos (30% - 200%)
          </div>
        </footer>
      </main>
    </div>
  );
}
