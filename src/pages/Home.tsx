import { useState, useEffect, useRef } from "react";
import { format, addDays, subDays } from "date-fns";
import JSZip from "jszip";
import { AVAILABLE_SYMBOLS, TWELVE_DATA_API_KEYS } from "@/lib/market-data";
import {
  buildOhlcCsv,
  removeRepeatedFlatlineArtifacts as removeRepeatedFlatlineArtifactsShared,
} from "@/lib/ohlc-generator";
import { Link } from "@tanstack/react-router";
import {
  setAnalysisSnapshot,
  type AnalysisChart,
} from "@/lib/analysis-store";
import html2canvas from "html2canvas";
import {
  LineChart,
  Settings,
  Play,
  Download,
  Image as ImageIcon,
  CheckCircle2,
  Loader2,
  Calendar,
  Key,
  Activity,
  AlertCircle,
  Search,
  Brain,
  History,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { cn } from "@/lib/utils";



export default function Home() {
  // Array of API keys to cycle through
  const apiKeys = TWELVE_DATA_API_KEYS;
  const apiKeyIndexRef = useRef(0);

  // Real-time EAT clock
  const [currentEAT, setCurrentEAT] = useState("");

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      // Calculate EAT (UTC+3)
      const eatHour = (now.getUTCHours() + 3) % 24;
      const eatMin = now.getUTCMinutes();
      setCurrentEAT(
        `${String(eatHour).padStart(2, "0")}:${String(eatMin).padStart(2, "0")}`,
      );
    };

    updateClock();
    const interval = setInterval(updateClock, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const [symbol, setSymbol] = useState("XAU/USD");
  const [openSymbolSearch, setOpenSymbolSearch] = useState(false);
  const [chartStartDate, setChartStartDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [chartEndDate, setChartEndDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [ohlcStartDate, setOhlcStartDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [ohlcEndDate, setOhlcEndDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [useCustomEndTime, setUseCustomEndTime] = useState(false);
  const [endTime, setEndTime] = useState("11:45");
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeOhlc, setIncludeOhlc] = useState(true);
  const [ohlcSpecifyTime, setOhlcSpecifyTime] = useState(false);
  const [ohlcStartTime, setOhlcStartTime] = useState("00:00");
  const [ohlcEndTime, setOhlcEndTime] = useState("23:59");
  const [ohlcCsvData, setOhlcCsvData] = useState<string | null>(null);

  // Automatically update endTime to currentEAT if we are NOT using a custom end time
  // This means if we switch from custom -> latest, the input will reflect the current time
  // And it will stay updated as long as custom is unchecked
  useEffect(() => {
    if (!useCustomEndTime && currentEAT) {
      setEndTime(currentEAT);
    }
  }, [useCustomEndTime, currentEAT]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<
    Record<
      string,
      {
        status: "idle" | "running" | "completed";
        current: number;
        total: number;
      }
    >
  >({
    "4h": { status: "idle", current: 0, total: 0 },
    "30m": { status: "idle", current: 0, total: 0 },
    "1h": { status: "idle", current: 0, total: 0 },
  });

  const [generatedFiles, setGeneratedFiles] = useState<
    {
      name: string;
      time: string;
      type: string;
      date?: string;
      candleData?: any[];
    }[]
  >([]);
  const generatedFilesRef = useRef<string[]>([]);
  const generatedFilesDataRef = useRef<
    {
      name: string;
      time: string;
      type: string;
      date?: string;
      candleData?: any[];
    }[]
  >([]);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [resumeTimer, setResumeTimer] = useState<number | null>(null);

  const addLog = (msg: string) => {
    console.log(msg);
    setConsoleLogs((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()}: ${msg}`,
    ]);
  };

  // Get current time in EAT (UTC+3)
  const formatEATTime = () => {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  };

  const removeRepeatedFlatlineArtifacts = removeRepeatedFlatlineArtifactsShared;


  // Generate TradingView-style SVG chart with real API data
  const createSvgContent = (
    fileName: string,
    timeframe: string,
    candleData: any[],
  ): string => {
    // Filter out weekend dates (Saturday = 6, Sunday = 0)
    const processedCandles = candleData.filter((c) => {
      // Explicit weekend filter based on date
      try {
        const dateOnly = String(c.time).replace("T", " ").substring(0, 10);
        const dateObj = new Date(`${dateOnly}T00:00:00Z`);
        const dayOfWeek = dateObj.getUTCDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) return false;
      } catch (e) {
        // Ignore date parsing errors
      }

      return true;
    });

    // Handle empty data
    if (!processedCandles || processedCandles.length === 0) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <rect width="1920" height="1080" fill="#0f0f0f"/>
  <text x="960" y="540" font-size="48" fill="#fff" text-anchor="middle">No data available</text>
  <text x="960" y="600" font-size="24" fill="#808080" text-anchor="middle">${timeframe.toUpperCase()}</text>
</svg>`;
    }

    // Chart dimensions
    const chartLeft = 180;
    const chartRight = 1800;
    const chartTop = 120;
    const chartBottom = 900;
    const chartWidth = chartRight - chartLeft;
    const chartHeight = chartBottom - chartTop;
    // Find actual min/max for scaling with padding
    const actualMin = Math.min(...processedCandles.map((c) => c.low));
    const actualMax = Math.max(...processedCandles.map((c) => c.high));
    const pricePadding = Math.max(0.5, (actualMax - actualMin) * 0.15);
    const displayMin = actualMin - pricePadding;
    const displayMax = actualMax + pricePadding;
    const basePrice = processedCandles[processedCandles.length - 1].close;

    const priceToY = (price: number) => {
      return (
        chartBottom -
        ((price - displayMin) / (displayMax - displayMin)) * chartHeight
      );
    };

    const candleCount = processedCandles.length;
    const slotWidth = chartWidth / candleCount;

    // Use wider bodies for the lower-candle-count 4H view.
    const widthMultiplier =
      timeframe === "4h" ? 0.58 : timeframe === "1h" ? 0.68 : 0.72;
    const candleWidth = Math.max(1, slotWidth * widthMultiplier);
    const xOffset = chartLeft + slotWidth / 2;
    const spacing = slotWidth;

    // Generate date/time labels
    const timeLabels: {
      time: string;
      isDate: boolean;
      x: number;
      isEndTime?: boolean;
    }[] = [];
    let lastDate = "";

    processedCandles.forEach((c, i) => {
      const dateTimeStr = c.time; // Format: YYYY-MM-DD HH:mm:ss
      const dateOnly = dateTimeStr.substring(0, 10);

      const xPos = xOffset + i * spacing;

      // TradingView logic:
      // Date changes are marked explicitly.
      // Then time is marked at specific sensible intervals depending on timeframe.

      let isNewDay = false;
      if (dateOnly !== lastDate) {
        // Show a readable EAT date at each day boundary.
        const dateObj = new Date(`${dateOnly}T00:00:00Z`);
        const month = dateObj.toLocaleString("en-US", {
          month: "short",
          timeZone: "UTC",
        });
        const dayNum = dateObj.getUTCDate();
        timeLabels.push({
          time: `${month} ${dayNum}`,
          isDate: true,
          x: xPos,
        });
        lastDate = dateOnly;
        isNewDay = true;
      }

      // Twelve Data returns these values in the requested Africa/Nairobi
      // timezone, so the timestamp is already EAT. Do not add another +3h.
      const normalizedTime = String(dateTimeStr).replace("T", " ");
      const timePart = normalizedTime.substring(11, 16);
      const eatHour = Number(timePart.substring(0, 2));
      const eatMin = Number(timePart.substring(3, 5));
      const eatTimeStr = `${String(eatHour).padStart(2, "0")}:${String(eatMin).padStart(2, "0")}`;

      // Don't draw a time label if we just drew a date label to prevent overlap
      if (!isNewDay && !Number.isNaN(eatHour) && !Number.isNaN(eatMin)) {
        if (timeframe === "4h") {
          if (eatMin === 0 && (eatHour === 0 || eatHour === 12)) {
            timeLabels.push({ time: eatTimeStr, isDate: false, x: xPos });
          }
        } else if (timeframe === "1h") {
          if (eatMin === 0 && (eatHour === 0 || eatHour === 12)) {
            timeLabels.push({ time: eatTimeStr, isDate: false, x: xPos });
          }
        } else if (timeframe === "30m") {
          if (eatMin === 0 && eatHour % 6 === 0) {
            timeLabels.push({ time: eatTimeStr, isDate: false, x: xPos });
          }
        }
      }
    });

    // Generate price labels (Y-axis)
    const priceLabels = [];
    const priceStep = (displayMax - displayMin) / 8;
    for (let i = 0; i <= 8; i++) {
      const price = displayMin + i * priceStep;
      priceLabels.push({
        price: price.toFixed(2),
        y: priceToY(price),
      });
    }

    // Use the actual first and last candle timestamps for the plain screenshot title.
    const formatScreenshotDateTime = (value: string) => {
      const normalized = String(value).replace("T", " ");
      const [datePart, timePart = "00:00"] = normalized.split(" ");
      const [year, month, day] = datePart.split("-");
      const [hour = "0", minute = "00"] = timePart.split(":");
      return `${Number(day)}/${Number(month)}/${year} ${Number(hour)}:${minute}`;
    };
    const screenshotTimeframe =
      timeframe === "4h" ? "4HR" : timeframe === "1h" ? "1HR" : "30MIN";
    const screenshotTitle = `${symbol.replace(/[\/\\]/g, "")} ${screenshotTimeframe} ${formatScreenshotDateTime(processedCandles[0].time)} to ${formatScreenshotDateTime(processedCandles[processedCandles.length - 1].time)}`;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .bg { fill: #0f0f0f; }
      .chart-bg { fill: #0a0a0a; }
      .grid-v { stroke: #1a1a1a; stroke-width: 1; opacity: 0.3; }
      .grid-h { stroke: #333333; stroke-width: 1; opacity: 0.6; stroke-dasharray: 4 4; }
      .axis { stroke: #2a2a2a; stroke-width: 2; }
      .title { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 52px; font-weight: bold; fill: #ffffff; }
      .label-price { font-family: 'Courier New', monospace; font-size: 20px; fill: #d0d0d0; font-weight: bold; }
      .label-date { font-family: 'Courier New', monospace; font-size: 24px; fill: #ffffff; font-weight: bold; }
      .label-time { font-family: 'Courier New', monospace; font-size: 20px; fill: #888888; }
      .candle-green { fill: #16c784; }
      .candle-red { fill: #f6465d; }
      .wick-green { stroke: #16c784; stroke-width: 1.5; }
      .wick-red { stroke: #f6465d; stroke-width: 1.5; }
    </style>
  </defs>
  
  <!-- Page background -->
  <rect class="bg" width="1920" height="1080"/>
  
  <!-- Chart background -->
  <rect class="chart-bg" x="${chartLeft}" y="${chartTop}" width="${chartWidth}" height="${chartHeight}"/>
  
  <!-- Horizontal grid lines and price labels -->
  ${priceLabels
    .map(
      (pl, i) => `
    ${i < priceLabels.length - 1 ? `<line class="grid-h" x1="${chartLeft}" y1="${pl.y}" x2="${chartRight}" y2="${pl.y}"/>` : ""}
    <text class="label-price" x="${chartRight + 15}" y="${pl.y + 7}" text-anchor="start">${pl.price}</text>
  `,
    )
    .join("\n  ")}
  
  <!-- Vertical grid lines matching labels -->
  ${timeLabels
    .map(
      (tl) => `
    <line class="grid-v" x1="${tl.x}" y1="${chartTop}" x2="${tl.x}" y2="${chartBottom}"/>
  `,
    )
    .join("\n  ")}
  
  <!-- Chart border -->
  <rect class="axis" x="${chartLeft}" y="${chartTop}" width="${chartWidth}" height="${chartHeight}" fill="none"/>
  
  <!-- Candlesticks (TradingView style) -->
  ${processedCandles
    .map((candle, i) => {
      const x = xOffset + i * spacing;
      const isGreen = candle.close >= candle.open;
      const wickY1 = priceToY(candle.high);
      const wickY2 = priceToY(candle.low);
      const bodyY1 = priceToY(candle.open);
      const bodyY2 = priceToY(candle.close);
      const bodyHeight = Math.abs(bodyY2 - bodyY1) || 1; // Ensure at least 1px height for dojis

      return `<line class="${isGreen ? "wick-green" : "wick-red"}" x1="${x}" y1="${wickY1}" x2="${x}" y2="${wickY2}"/>
    <rect class="${isGreen ? "candle-green" : "candle-red"}" x="${x - candleWidth / 2}" y="${Math.min(bodyY1, bodyY2)}" width="${candleWidth}" height="${bodyHeight}"/>`;
    })
    .join("\n  ")}
  
  <!-- Time axis labels -->
  ${timeLabels.map((tl) => `<text class="${tl.isDate ? "label-date" : "label-time"}" x="${tl.x}" y="${chartBottom + (tl.isDate ? 45 : 25)}" text-anchor="middle">${tl.time}</text>`).join("\n  ")}
  
  <!-- Plain historical screenshot title -->
  <text class="title" x="60" y="78">${screenshotTitle}</text>
</svg>`;
    return svg;
  };

  const svgToPng = async (svgString: string): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const img = new Image();

      // Ensure namespace is present
      let finalSvgString = svgString;
      if (!finalSvgString.includes('xmlns="http://www.w3.org/2000/svg"')) {
        finalSvgString = finalSvgString.replace(
          "<svg ",
          '<svg xmlns="http://www.w3.org/2000/svg" ',
        );
      }

      // Convert to base64 data URI which is the most reliable way to load SVGs into Image objects
      const base64Svg = btoa(unescape(encodeURIComponent(finalSvgString)));
      const url = `data:image/svg+xml;base64,${base64Svg}`;

      // Prevent hanging forever
      const timeoutId = setTimeout(() => {
        console.warn("SVG to PNG conversion timed out");
        resolve(null);
      }, 5000);

      img.onload = () => {
        clearTimeout(timeoutId);
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 1920;
          canvas.height = 1080;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }

          // Draw background
          ctx.fillStyle = "#0f0f0f";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Draw SVG
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else resolve(null);
            },
            "image/png",
            1.0,
          );
        } catch (err) {
          console.error("Canvas conversion error:", err);
          resolve(null);
        }
      };

      img.onerror = (e) => {
        clearTimeout(timeoutId);
        console.error("SVG to Image load error");
        resolve(null);
      };

      img.src = url;
    });
  };

  // Capture the freshly generated charts + CSV so the Analysis tab can feed them to the models.
  const saveAnalysisSnapshot = async (csvOverride?: string | null) => {
    try {
      const filesSnapshot = generatedFilesDataRef.current;
      const charts: AnalysisChart[] = [];
      for (const tf of ["4h", "1h", "30m"]) {
        const file = filesSnapshot.find(
          (f) => f.type === tf && !!f.candleData && f.candleData.length > 0,
        );
        if (!file || !file.candleData) continue;
        const svgContent = createSvgContent(file.name, tf, file.candleData);
        const pngBlob = await svgToPng(svgContent);
        if (!pngBlob) continue;
        const pngDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(pngBlob);
        });
        charts.push({ name: file.name, timeframe: tf, pngDataUrl });
      }
      const csv = csvOverride !== undefined ? csvOverride : ohlcCsvData;
      setAnalysisSnapshot({
        symbol,
        createdAt: `${format(new Date(), "yyyy-MM-dd")} ${formatEATTime()}`,
        range: `${ohlcStartDate} \u2192 ${ohlcEndDate}`,
        csvName: csv
          ? `${symbol.replace("/", "")}_30min_${ohlcStartDate}_to_${ohlcEndDate}.csv`
          : null,
        ohlcCsv: csv ?? null,
        charts,
      });
    } catch (e) {
      console.error("Failed to capture analysis snapshot", e);
    }
  };

  const handleDownloadCsv = (csvOverride?: string | null) => {
    const csvToUse = csvOverride !== undefined ? csvOverride : ohlcCsvData;
    if (!csvToUse) {
      toast.error("No OHLC data available yet");
      return;
    }
    const csvFileName = `${symbol.replace("/", "")}_30min_${ohlcStartDate}_to_${ohlcEndDate}.csv`;
    const blob = new Blob([csvToUse], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Downloaded ${csvFileName}`);
  };

  const handleDownload = async (csvOverride?: string | null) => {
    const filesSnapshot = generatedFilesDataRef.current;
    const chartFiles = filesSnapshot.filter(
      (file) =>
        ["4h", "1h", "30m"].includes(file.type) &&
        !!file.candleData &&
        file.candleData.length > 0,
    );
    const hasCharts = includeCharts && chartFiles.length > 0;
    const csvToUse = csvOverride !== undefined ? csvOverride : ohlcCsvData;
    const hasCsv = includeOhlc && !!csvToUse;

    if (!hasCharts && !hasCsv) {
      toast.error("Nothing to download yet");
      return;
    }

    if (isDownloading) return;

    try {
      setIsDownloading(true);
      toast.info("Preparing ZIP file...", { duration: 3000 });
      const zip = new JSZip();
      let addedCount = 0;

      // Add chart PNGs if applicable
      if (hasCharts) {
        const filesByTimeframe = {
          "4h": chartFiles.filter((f) => f.type === "4h"),
          "30m": chartFiles.filter((f) => f.type === "30m"),
          "1h": chartFiles.filter((f) => f.type === "1h"),
        };
        for (const [timeframe, files] of Object.entries(filesByTimeframe)) {
          for (const file of files) {
            try {
              if (file.candleData && file.candleData.length > 0) {
                const svgContent = createSvgContent(
                  file.name,
                  timeframe,
                  file.candleData,
                );
                const pngBlob = await svgToPng(svgContent);
                // Never allow the forex pair slash to become a ZIP folder.
                const safeFileName = file.name.replace(/[\/\\]/g, "");
                if (pngBlob) {
                  zip.file(safeFileName.replace(".svg", ".png"), pngBlob);
                } else {
                  zip.file(safeFileName, svgContent);
                }
                addedCount++;
              }
            } catch (e) {
              console.error(`Error processing file ${file.name}:`, e);
            }
          }
        }
      }

      // Add OHLC CSV if applicable
      if (hasCsv && csvToUse) {
        const csvFileName = `${symbol.replace("/", "")}_30min_${ohlcStartDate}_to_${ohlcEndDate}.csv`;
        zip.file(csvFileName, csvToUse);
        addedCount++;
      }

      if (addedCount === 0) {
        toast.error("No files could be generated.");
        return;
      }

      toast.info(`Zipping ${addedCount} item(s)...`, { duration: 2000 });
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `forexlens-${symbol.replace("/", "")}-${format(new Date(), "yyyy-MM-dd-HHmmss")}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Downloaded successfully!`);
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Failed to package and download files");
    } finally {
      setIsDownloading(false);
    }
  };

  const fetchOhlcData = async (): Promise<string | null> =>
    buildOhlcCsv({
      symbol,
      startDate: ohlcStartDate,
      endDate: ohlcEndDate,
      specifyTime: ohlcSpecifyTime,
      startTime: ohlcStartTime,
      endTime: ohlcEndTime,
      apiKeys,
      keyIndexRef: apiKeyIndexRef,
      log: addLog,
      setCooldown: setResumeTimer,
    });


  const fetchCandleData = async (
    tf: string,
    fromDate: string,
    toDate: string,
    endDateStrParam?: string,
  ): Promise<any[]> => {
    while (true) {
      try {
        // Add delay to respect rate limits (8 credits per minute max)
        await new Promise((resolve) => setTimeout(resolve, 150));

        const currentApiKey = apiKeys[apiKeyIndexRef.current];

        // Build Twelve Data API URL - correct endpoint is time_series (with underscore)
        const interval = tf === "4h" ? "4h" : tf === "30m" ? "30min" : "1h";

        // We must pass date strings to twelvedata without seconds and keeping it clean
        // Replace space with T and remove seconds if any, or just pass as YYYY-MM-DD HH:MM
        const cleanFromDate = fromDate.replace(" ", "T");
        const cleanToDate = toDate.replace(" ", "T");

        const params = new URLSearchParams({
          apikey: currentApiKey,
          symbol: symbol,
          interval: interval,
          start_date: cleanFromDate,
          timezone: "Africa/Nairobi",
          outputsize: "5000", // Ensure long 4H/1H windows are not truncated.
        });

        if (endDateStrParam) {
          params.append("end_date", endDateStrParam.replace(" ", "T"));
        }
        const url = `https://api.twelvedata.com/time_series?${params.toString()}`;

        // Let's format the log to show what we are actually requesting
        addLog(
          `🔄 API Req [EAT]: ${interval} ${fromDate} -> ${toDate} (Key ${apiKeyIndexRef.current + 1})`,
        );

        const response = await fetch(url);

        // Let's parse the response text first since we might need it for both error logging and JSON parsing
        const responseText = await response.text();

        let data: any = {};
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          // If it's not JSON, handle it as a raw HTTP error
          if (!response.ok) {
            addLog(
              `❌ API Error: ${response.status} - ${responseText.substring(0, 50)}`,
            );
            return [];
          }
        }

        // Detect rate limit (can be HTTP 429 OR a 200 OK with status: 'error')
        const isRateLimit =
          response.status === 429 ||
          (data.status === "error" &&
            data.message &&
            data.message.includes("run out of API credits")) ||
          data.code === 429;

        if (isRateLimit) {
          // If we have more keys to try, rotate to the next one and retry
          if (apiKeyIndexRef.current < apiKeys.length - 1) {
            apiKeyIndexRef.current++;
            addLog(
              `🔄 Rate limit hit. Switching to API Key ${apiKeyIndexRef.current + 1}/${apiKeys.length}...`,
            );
            continue; // Retry in next iteration of the while loop
          } else {
            // All keys exhausted, start the 60 second timer and wait inline
            addLog(
              `🛑 ALL KEYS EXHAUSTED! Waiting 60 seconds before resuming...`,
            );
            apiKeyIndexRef.current = 0; // Reset for when it resumes
            setResumeTimer(60);
            await new Promise((resolve) => setTimeout(resolve, 60000));
            setResumeTimer(null);
            addLog(`✅ Timer expired, resuming with Key 1...`);
            continue; // Retry in next iteration
          }
        }

        // Handle specific "No data" API response which sometimes comes as a 400
        const isNoData =
          (data.code === 400 || data.status === "error") &&
          data.message &&
          data.message.includes("No data is available");

        if (isNoData) {
          addLog(`⚠️ API returned no data for this period`);
          return [];
        }

        if (!response.ok && !isRateLimit) {
          addLog(
            `❌ API Error: ${response.status} - ${responseText.substring(0, 50)}`,
          );
          return [];
        }

        if (data.status === "error") {
          // For any other unexpected error, log and return empty to avoid infinite loop
          addLog(`❌ Unexpected API message: ${data.message}`);
          return [];
        }

        // Format candle data from API response
        const candles = (data.values || []).map((v: any) => ({
          time: v.datetime,
          open: parseFloat(v.open),
          close: parseFloat(v.close),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
        }));

        const orderedCandles = candles.reverse(); // Reverse to show oldest first
        const intervalMinutes = tf === "4h" ? 240 : tf === "1h" ? 60 : 30;
        const cleanedCandles = removeRepeatedFlatlineArtifacts(
          orderedCandles,
          intervalMinutes,
        );
        if (cleanedCandles.removedCount > 0) {
          addLog(
            `🧹 Skipped ${cleanedCandles.removedCount} repeated flatline ${tf} chart candle(s)`,
          );
        }

        addLog(`✅ Got ${cleanedCandles.candles.length} candles for ${tf}`);

        return cleanedCandles.candles;
      } catch (error) {
        const errMsg = `❌ Fetch error: ${String(error).substring(0, 50)}`;
        addLog(errMsg);
        return [];
      }
    }
  };

  // Generate realistic mock candle data with trending patterns
  const generateMockCandles = (tf: string) => {
    const candleCount = tf === "4h" ? 78 : tf === "30m" ? 144 : 120;
    const candles = [];
    let price = 2065 + Math.random() * 20; // Realistic XAUUSD range
    const trend = Math.random() > 0.5 ? 0.2 : -0.2; // Overall trend direction

    for (let i = 0; i < candleCount; i++) {
      // Add realistic price movement with trend
      const trendComponent = trend * (i / candleCount);
      const randomComponent = (Math.random() - 0.5) * 3;
      const volatility = 0.5 + Math.sin(i / 5) * 0.3; // Cyclical volatility

      const open = price;
      const close = price + trendComponent + randomComponent;
      const high =
        Math.max(open, close) +
        Math.abs(randomComponent) * volatility +
        Math.random() * 1.5;
      const low =
        Math.min(open, close) -
        Math.abs(randomComponent) * volatility -
        Math.random() * 1.5;

      // Add occasional larger moves (realistic gaps)
      const isLargeMove = Math.random() < 0.05;
      const largeMove = isLargeMove ? (Math.random() - 0.5) * 8 : 0;

      candles.push({
        time: new Date(Date.now() - (candleCount - i) * 60000).toISOString(),
        open: open + largeMove,
        close: close + largeMove,
        high: high + largeMove,
        low: low + largeMove,
      });

      price = close + largeMove;
    }

    return candles;
  };

  const executeGeneration = async (
    startDateObj: Date,
    endDateObj: Date,
    daysSpan: number,
    endHour: number,
    endMin: number,
    timeframes: Array<{ tf: string; label: string; lookbackHours: number }>,
  ) => {
    let totalFilesAdded = 0;

    // Generate one chart per trading day for each timeframe.
    for (const { tf, label, lookbackHours } of timeframes) {
      addLog(`\n📊 Starting ${label} generation...`);
      let fileCount = 0;
      const generatedTargetDates = new Set<string>();

      for (let dayOffset = 0; dayOffset < daysSpan; dayOffset++) {
        // Resolve weekend selections to the previous trading day instead of
        // silently producing no charts (for example, a Sunday-only range).
        const currentTargetDate = new Date(startDateObj);
        currentTargetDate.setDate(currentTargetDate.getDate() + dayOffset);

        while (
          currentTargetDate.getDay() === 0 ||
          currentTargetDate.getDay() === 6
        ) {
          currentTargetDate.setDate(currentTargetDate.getDate() - 1);
        }

        const targetDateKey = format(currentTargetDate, "yyyy-MM-dd");
        if (generatedTargetDates.has(targetDateKey)) {
          addLog(
            `⏭️ Weekend maps to already generated trading day: ${targetDateKey}`,
          );
          continue;
        }
        generatedTargetDates.add(targetDateKey);

        // If we already generated this file in a previous run, skip it
        const safeSymbol = symbol.replace(/[\/\\]/g, "");
        const expectedFileName = `${safeSymbol}_${label}_`; // Prefix matching
        const fileExists = generatedFilesRef.current.some(
          (name) =>
            name.includes(expectedFileName) && name.includes(`Day${dayOffset}`),
        );

        if (fileExists) {
          fileCount++;
          continue;
        }

        // Calculate end time for this day based on the user's specific end time
        const chartEndDate = new Date(currentTargetDate);

        // Use the finalEndHour/finalEndMin passed into executeGeneration
        if (dayOffset === daysSpan - 1) {
          // Last day always ends exactly at the specified hour/minute
          chartEndDate.setHours(endHour, endMin, 0, 0);
        } else {
          // For previous days, if we are NOT using a custom time, we want the whole day (23:59 EAT)
          if (!useCustomEndTime) {
            chartEndDate.setHours(23, 59, 0, 0);
          } else {
            // If using a custom time, every day ends at that specific time
            chartEndDate.setHours(endHour, endMin, 0, 0);
          }
        }

        // Calculate each requested window in trading days, skipping weekends.
        let chartStartDate = new Date(chartEndDate);

        const tradingDaysToShow = lookbackHours;
        let tradingDaysSubtracted = 0;

        while (tradingDaysSubtracted < tradingDaysToShow) {
          chartStartDate.setDate(chartStartDate.getDate() - 1);
          const dayOfWeek = chartStartDate.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            tradingDaysSubtracted++;
          }
        }

        // We no longer need to subtract 3 hours to get UTC!
        // We set the timezone to "Africa/Nairobi" in the API request, so we can just pass EAT directly.
        const fromDateStr = format(chartStartDate, "yyyy-MM-dd HH:mm");
        const toDateStr = format(chartEndDate, "yyyy-MM-dd HH:mm");

        // ALWAYS use the end date. The TwelveData API needs the end date to know *where* to stop counting backwards from.
        // If we omit it, it defaults to "now", but we might be fetching data for yesterday!
        const endDateStrParam = toDateStr;

        try {
          // Fetch real data from API
          const candleData = await fetchCandleData(
            tf,
            fromDateStr,
            toDateStr,
            endDateStrParam,
          );

          if (candleData && candleData.length > 0) {
            // We use the EAT dates for the file name so the user sees their time
            const safeSymbol = symbol.replace(/[\/\\]/g, "");
            const newFile = {
              name: `${safeSymbol}_${label}_${format(chartStartDate, "MMM-dd-HH")}_${format(chartEndDate, "MMM-dd-HH")}_Day${dayOffset}.svg`,
              time: formatEATTime(),
              type: tf,
              date: format(chartEndDate, "MMM dd, yyyy"),
              candleData,
            };

            generatedFilesRef.current.push(newFile.name);
            generatedFilesDataRef.current.unshift(newFile);
            setGeneratedFiles((prev) => [newFile, ...prev]);
            fileCount++;
            totalFilesAdded++;
          } else {
            addLog(
              `⚠️ No data found for ${format(chartEndDate, "yyyy-MM-dd")}, skipping file creation`,
            );
          }

          setProgress((prev) => ({
            ...prev,
            [tf]: {
              ...prev[tf],
              current: fileCount,
              status: "running" as const,
            },
          }));
        } catch (error) {
          addLog(
            `❌ Error for ${label} - Day ${dayOffset + 1}/${daysSpan}: ${String(error)}`,
          );
          // We don't break the loop anymore, just log and continue to the next day
        }
      }

      addLog(`✅ ${label} complete: ${fileCount} files`);
      setProgress((prev) => ({
        ...prev,
        [tf]: {
          ...prev[tf],
          status: "completed" as const,
        },
      }));
    }

    return totalFilesAdded;
  };

  useEffect(() => {
    if (resumeTimer === null) return;

    let timerRef: NodeJS.Timeout;

    // Only set up interval if we actually have a timer running
    if (resumeTimer > 0) {
      timerRef = setInterval(() => {
        setResumeTimer((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            clearInterval(timerRef);
            return 0; // Reach 0 to trigger the effect
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef) clearInterval(timerRef);
    };
  }, [resumeTimer]);

  const handleGenerate = async () => {
    if (!symbol || !chartStartDate || !chartEndDate) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      setConsoleLogs([]); // Clear console
      setResumeTimer(null);

      // Don't clear generated files on resume, only on fresh start
      if (!isGenerating) {
        setGeneratedFiles([]);
        generatedFilesRef.current = [];
        generatedFilesDataRef.current = [];
        addLog("🚀 Starting generation...");
      } else {
        addLog("▶️ Resuming generation...");
      }

      setIsGenerating(true);

      // Parse times
      let endHour = 23;
      let endMin = 59;
      if (useCustomEndTime) {
        [endHour, endMin] = endTime.split(":").map(Number);
      }

      if (!isGenerating) {
        if (useCustomEndTime) {
          addLog(
            `⏰ Time: 00:00 to ${endHour}:${String(endMin).padStart(2, "0")} EAT`,
          );
        } else {
          addLog(`⏰ Time: Latest available data`);
        }

        // Calculate date range
        const startDateObj = new Date(chartStartDate);
        const endDateObj = new Date(chartEndDate);
        const daysSpan =
          Math.floor(
            (endDateObj.getTime() - startDateObj.getTime()) /
              (1000 * 60 * 60 * 24),
          ) + 1;

        addLog(
          `📅 Dates: ${chartStartDate} to ${chartEndDate} (${daysSpan} days)`,
        );
      }

      const startDateObj = new Date(chartStartDate);
      const endDateObj = new Date(chartEndDate);
      const daysSpan =
        Math.floor(
          (endDateObj.getTime() - startDateObj.getTime()) /
            (1000 * 60 * 60 * 24),
        ) + 1;

      // Chart windows are expressed in trading days:
      // 4H = 13 days, 1H = 5 days, 30M = 3 days.
      const timeframes = [
        { tf: "4h", label: "4H", lookbackHours: 13 },
        { tf: "1h", label: "1H", lookbackHours: 5 },
        { tf: "30m", label: "30M", lookbackHours: 3 },
      ];

      if (!isGenerating) {
        setProgress({
          "4h": { status: "running", current: 0, total: daysSpan },
          "30m": { status: "running", current: 0, total: daysSpan },
          "1h": { status: "running", current: 0, total: daysSpan },
        });
      }

      let localRateLimitHit = false;

      const runBatch = async () => {
        try {
          let finalEndHour = endHour;
          let finalEndMin = endMin;
          if (!useCustomEndTime) {
            const now = new Date();
            finalEndHour = (now.getUTCHours() + 3) % 24;
            finalEndMin = now.getUTCMinutes();
          }

          // Step 1: Generate charts if selected
          let filesAdded = 0;
          if (includeCharts) {
            filesAdded = await executeGeneration(
              startDateObj,
              endDateObj,
              daysSpan,
              finalEndHour,
              finalEndMin,
              timeframes,
            );
            if (filesAdded === 0) {
              addLog(
                `⚠️ No chart files were generated. Check the selected dates and API response.`,
              );
              toast.warning("No chart files were generated");
            }
          }

          // Step 2: Fetch OHLC data if selected
          let fetchedCsv: string | null = null;
          if (includeOhlc) {
            fetchedCsv = await fetchOhlcData();
            setOhlcCsvData(fetchedCsv);
            if (fetchedCsv) {
              const csvFileName = `${symbol.replace("/", "")}_30min_${ohlcStartDate}_to_${ohlcEndDate}.csv`;
              const ohlcEntry = {
                name: csvFileName,
                time: formatEATTime(),
                type: "ohlc",
                date: `${ohlcStartDate} → ${ohlcEndDate}`,
              };
              generatedFilesDataRef.current.unshift(ohlcEntry);
              setGeneratedFiles((prev) => [ohlcEntry, ...prev]);
            }
          }

          setIsGenerating(false);
          setResumeTimer(null);
          addLog(`\n🎉 All done! Starting download...`);
          toast.success(`Complete! Packaging download...`);

          if (filesAdded > 0 || fetchedCsv) {
            await saveAnalysisSnapshot(fetchedCsv);
            handleDownload(fetchedCsv);
          }
        } catch (error) {
          addLog(`❌ Error: ${String(error)}`);
          toast.error("Error during generation");
          setIsGenerating(false);
        }
      };

      // Start the first batch
      runBatch();
    } catch (error) {
      addLog(`❌ Error: ${String(error)}`);
      toast.error("Error starting generation");
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-black/95 backdrop-blur-xl">
        <div className="container mx-auto px-6 h-14 flex items-center justify-between max-w-7xl">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <LineChart size={16} strokeWidth={2.5} className="text-white" />
            </div>
            <Link
              to="/analysis"
              className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/20 transition-colors"
            >
              <Brain size={12} /> Analysis
            </Link>
            <Link
              to="/backtest"
              className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/20 transition-colors"
            >
              <History size={12} /> Backtest
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] text-white/40 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              Live
            </span>
            {currentEAT && (
              <span className="hidden sm:flex items-center gap-1.5 ml-4 text-[11px] font-mono text-white/40">
                <Activity size={11} className="text-primary" />
                {currentEAT} <span className="text-white/20">EAT</span>
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ═══ MAIN LAYOUT ═══ */}
      <main className="flex-1 container mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-5 max-w-7xl">
        {/* ─── SIDEBAR ─── */}
        <aside className="lg:col-span-4 space-y-3">
          {/* ── CHART SCREENSHOTS BLOCK ── */}
          <div className="rounded-xl border border-white/6 bg-[#0d0608] overflow-hidden">
            {/* Block title bar */}
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-primary/8">
              <div>
                <h2 className="text-base font-black text-white tracking-tight leading-none">
                  Chart Screenshots
                </h2>
                <p className="text-[11px] text-white/35 mt-1 font-mono">
                  PNG · 4H · 1H · 30M
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
                <ImageIcon size={16} className="text-primary" />
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Symbol picker */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-white/35 uppercase tracking-[0.15em]">
                  Symbol
                </p>
                <Popover
                  open={openSymbolSearch}
                  onOpenChange={setOpenSymbolSearch}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openSymbolSearch}
                      className="w-full justify-between bg-black/60 border-white/10 hover:border-primary/50 hover:bg-black/80 font-mono text-sm font-bold uppercase h-11 rounded-lg transition-all text-white"
                    >
                      <span className="flex items-center gap-2">
                        {symbol ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-primary inline-block shrink-0" />
                            {symbol}
                          </>
                        ) : (
                          <span className="text-white/30 font-normal">
                            Select symbol…
                          </span>
                        )}
                      </span>
                      <Search size={13} className="text-white/25 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-[#0d0608] border-white/10 rounded-xl shadow-2xl">
                    <Command className="bg-transparent">
                      <CommandInput
                        placeholder="Search symbol…"
                        className="font-mono text-xs uppercase border-b border-white/10"
                      />
                      <CommandList className="max-h-[220px]">
                        <CommandEmpty className="py-4 text-center text-sm text-white/30">
                          Not found.
                        </CommandEmpty>
                        <CommandGroup>
                          {AVAILABLE_SYMBOLS.map((sym) => (
                            <CommandItem
                              key={sym}
                              value={sym}
                              onSelect={(v) => {
                                setSymbol(v === symbol ? "" : v.toUpperCase());
                                setOpenSymbolSearch(false);
                              }}
                              className="font-mono text-xs uppercase cursor-pointer aria-selected:bg-primary/20 aria-selected:text-primary hover:bg-white/5"
                            >
                              <CheckCircle2
                                className={cn(
                                  "mr-2 h-3.5 w-3.5 text-primary shrink-0",
                                  symbol === sym ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {sym}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Date range */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-white/35 uppercase tracking-[0.15em]">
                  Date Range
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[9px] text-white/25 font-mono uppercase mb-1.5 tracking-wider">
                      Start
                    </p>
                    <Input
                      type="date"
                      value={chartStartDate}
                      onChange={(e) => setChartStartDate(e.target.value)}
                      className="bg-black/60 border-white/10 hover:border-primary/40 focus:border-primary font-mono text-xs h-10 rounded-lg transition-all text-white"
                      data-testid="input-start-date"
                    />
                  </div>
                  <div>
                    <p className="text-[9px] text-white/25 font-mono uppercase mb-1.5 tracking-wider">
                      End
                    </p>
                    <Input
                      type="date"
                      value={chartEndDate}
                      onChange={(e) => setChartEndDate(e.target.value)}
                      className="bg-black/60 border-white/10 hover:border-primary/40 focus:border-primary font-mono text-xs h-10 rounded-lg transition-all text-white"
                      data-testid="input-end-date"
                    />
                  </div>
                </div>
              </div>

              {/* End time */}
              <div className="space-y-2">
                <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={useCustomEndTime}
                    onChange={(e) => setUseCustomEndTime(e.target.checked)}
                    className="accent-primary h-3.5 w-3.5 cursor-pointer"
                  />
                  <span className="text-[11px] font-semibold text-white/50 group-hover:text-white/80 transition-colors">
                    Custom end time{" "}
                    <span className="font-mono text-white/25">(EAT)</span>
                  </span>
                  {!useCustomEndTime && (
                    <span className="ml-auto text-[10px] font-mono text-primary/60">
                      → Latest
                    </span>
                  )}
                </label>
                {useCustomEndTime && (
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="bg-black/60 border-white/10 hover:border-primary/40 focus:border-primary font-mono text-sm h-10 rounded-lg animate-in fade-in slide-in-from-top-1 text-white"
                    data-testid="input-end-time"
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── OHLC DATA BLOCK ── */}
          <div className="rounded-xl border border-white/6 bg-[#0d0608] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-primary/5">
              <div>
                <h2 className="text-base font-black text-white tracking-tight leading-none">
                  OHLC Data
                </h2>
                <p className="text-[11px] text-white/35 mt-1 font-mono">
                  CSV · 30-minute · EAT timezone
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Activity size={16} className="text-primary/70" />
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* OHLC date range */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-white/35 uppercase tracking-[0.15em]">
                  Date Range
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[9px] text-white/25 font-mono uppercase mb-1.5 tracking-wider">
                      Start
                    </p>
                    <Input
                      type="date"
                      value={ohlcStartDate}
                      onChange={(e) => setOhlcStartDate(e.target.value)}
                      className="bg-black/60 border-white/10 hover:border-primary/40 focus:border-primary font-mono text-xs h-10 rounded-lg transition-all text-white"
                    />
                  </div>
                  <div>
                    <p className="text-[9px] text-white/25 font-mono uppercase mb-1.5 tracking-wider">
                      End
                    </p>
                    <Input
                      type="date"
                      value={ohlcEndDate}
                      onChange={(e) => setOhlcEndDate(e.target.value)}
                      className="bg-black/60 border-white/10 hover:border-primary/40 focus:border-primary font-mono text-xs h-10 rounded-lg transition-all text-white"
                    />
                  </div>
                </div>
              </div>

              {/* OHLC time range */}
              <div className="space-y-2">
                <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={ohlcSpecifyTime}
                    onChange={(e) => setOhlcSpecifyTime(e.target.checked)}
                    className="accent-primary h-3.5 w-3.5 cursor-pointer"
                  />
                  <span className="text-[11px] font-semibold text-white/50 group-hover:text-white/80 transition-colors">
                    Specify time range{" "}
                    <span className="font-mono text-white/25">(EAT)</span>
                  </span>
                </label>
                {ohlcSpecifyTime && (
                  <div className="grid grid-cols-2 gap-2 animate-in fade-in slide-in-from-top-1">
                    <div>
                      <p className="text-[9px] text-white/25 font-mono uppercase mb-1.5 tracking-wider">
                        From
                      </p>
                      <Input
                        type="time"
                        value={ohlcStartTime}
                        onChange={(e) => setOhlcStartTime(e.target.value)}
                        className="bg-black/60 border-white/10 hover:border-primary/40 font-mono text-sm h-10 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <p className="text-[9px] text-white/25 font-mono uppercase mb-1.5 tracking-wider">
                        To
                      </p>
                      <Input
                        type="time"
                        value={ohlcEndTime}
                        onChange={(e) => setOhlcEndTime(e.target.value)}
                        className="bg-black/60 border-white/10 hover:border-primary/40 font-mono text-sm h-10 rounded-lg text-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── DOWNLOAD ── */}
          <div className="rounded-xl border border-white/6 bg-[#0d0608] p-5 space-y-4">
            <p className="text-[10px] font-bold text-white/35 uppercase tracking-[0.15em]">
              Include in Download
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all select-none",
                  includeCharts
                    ? "border-primary/40 bg-primary/8"
                    : "border-white/8 bg-black/30 hover:border-white/15",
                )}
              >
                <input
                  type="checkbox"
                  checked={includeCharts}
                  onChange={(e) => setIncludeCharts(e.target.checked)}
                  className="accent-primary h-4 w-4 cursor-pointer shrink-0"
                />
                <div>
                  <p
                    className={cn(
                      "text-sm font-bold leading-none",
                      includeCharts ? "text-white" : "text-white/50",
                    )}
                  >
                    Charts
                  </p>
                  <p className="text-[10px] text-white/25 font-mono mt-1">
                    PNG · 4H 1H 30M
                  </p>
                </div>
              </label>
              <label
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all select-none",
                  includeOhlc
                    ? "border-primary/40 bg-primary/8"
                    : "border-white/8 bg-black/30 hover:border-white/15",
                )}
              >
                <input
                  type="checkbox"
                  checked={includeOhlc}
                  onChange={(e) => setIncludeOhlc(e.target.checked)}
                  className="accent-primary h-4 w-4 cursor-pointer shrink-0"
                />
                <div>
                  <p
                    className={cn(
                      "text-sm font-bold leading-none",
                      includeOhlc ? "text-white" : "text-white/50",
                    )}
                  >
                    OHLC CSV
                  </p>
                  <p className="text-[10px] text-white/25 font-mono mt-1">
                    30M · EAT
                  </p>
                </div>
              </label>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={isGenerating || (!includeCharts && !includeOhlc)}
              className="w-full h-12 font-black text-sm tracking-wide rounded-xl bg-primary hover:bg-primary/85 text-white shadow-lg shadow-primary/20 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="button-generate"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Generate & Download
                </>
              )}
            </Button>
          </div>
        </aside>

        {/* ─── MAIN CONTENT ─── */}
        <div className="lg:col-span-8 space-y-4">
          {/* Progress cards */}
          <div className="grid grid-cols-3 gap-3">
            {(["4h", "1h", "30m"] as const).map((tf) => {
              const s = progress[tf];
              const pct = s.total > 0 ? (s.current / s.total) * 100 : 0;
              const isActive = s.status === "running";
              const isDone = s.status === "completed";
              return (
                <div
                  key={tf}
                  className={cn(
                    "rounded-xl border p-4 space-y-3 relative overflow-hidden transition-all duration-500",
                    isActive
                      ? "border-primary/40 bg-primary/5"
                      : isDone
                        ? "border-emerald-500/20 bg-emerald-500/3"
                        : "border-white/6 bg-[#0d0608]",
                  )}
                >
                  {isActive && (
                    <div className="absolute inset-0 bg-primary/4 animate-pulse-glow pointer-events-none" />
                  )}
                  <div className="flex items-start justify-between relative z-10">
                    <div>
                      <p className="text-[9px] text-white/25 font-mono uppercase tracking-[0.2em] mb-1">
                        Timeframe
                      </p>
                      <p className="text-3xl font-black text-white tracking-tighter leading-none">
                        {tf.toUpperCase()}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border",
                        !isActive &&
                          !isDone &&
                          "text-white/30 border-white/10 bg-white/3",
                        isActive &&
                          "text-primary border-primary/40 bg-primary/12",
                        isDone &&
                          "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
                      )}
                    >
                      {s.status === "idle"
                        ? "Ready"
                        : s.status === "running"
                          ? "Active"
                          : "Done"}
                    </span>
                  </div>
                  <div className="space-y-1.5 relative z-10">
                    <div className="flex justify-between text-[10px] font-mono text-white/30">
                      <span>Progress</span>
                      <span className={isActive ? "text-primary" : ""}>
                        {s.current} / {s.total || "–"}
                      </span>
                    </div>
                    <div className="h-0.5 w-full bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-700 ease-out",
                          isDone ? "bg-emerald-500" : "bg-primary",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Generated assets panel */}
          <div
            className="rounded-xl border border-white/6 bg-[#0d0608] overflow-hidden flex flex-col"
            style={{
              height: consoleLogs.length > 0 ? "400px" : "calc(100vh - 320px)",
              minHeight: "300px",
              transition: "height 0.4s ease",
            }}
          >
            <div className="px-5 py-3.5 border-b border-white/5 bg-black/20 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-md bg-primary/12 border border-primary/20 flex items-center justify-center">
                  <ImageIcon size={13} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white leading-none">
                    Generated Assets
                  </h2>
                  <p className="text-[10px] text-white/25 font-mono mt-0.5">
                    Output directory
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => handleDownload()}
                disabled={
                  generatedFiles.length === 0 || isGenerating || isDownloading
                }
                className="h-8 px-4 text-xs font-bold border border-primary/40 text-primary bg-primary/10 hover:bg-primary/20 hover:border-primary/60 transition-all rounded-lg disabled:opacity-25 disabled:cursor-not-allowed"
                data-testid="button-download"
              >
                {isDownloading ? (
                  <Loader2 size={11} className="mr-1.5 animate-spin" />
                ) : (
                  <Download size={11} className="mr-1.5" />
                )}
                {isDownloading ? "Zipping…" : "Download ZIP"}
              </Button>
            </div>

            <div className="flex-1 overflow-hidden relative">
              {generatedFiles.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-xl border border-white/5 flex items-center justify-center bg-primary/5">
                    <ImageIcon size={20} className="text-primary/30" />
                  </div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/15">
                    Awaiting Output
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-full p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {generatedFiles.map((file, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-black/30 hover:border-primary/25 hover:bg-black/50 transition-all animate-in fade-in zoom-in-95"
                      >
                        <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={13} className="text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-white/70 truncate">
                            {file.name}
                          </p>
                          <p className="text-[10px] text-white/30 font-mono mt-0.5 flex items-center gap-1.5">
                            <span className="text-primary font-bold">
                              {file.type.toUpperCase()}
                            </span>
                            <span className="opacity-40">·</span>
                            <span>{file.date || file.time}</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          {/* System terminal */}
          {consoleLogs.length > 0 && (
            <div className="rounded-xl border border-white/6 bg-[#050204] overflow-hidden flex flex-col h-48">
              <div className="px-4 py-2.5 border-b border-white/5 bg-black/50 flex items-center gap-2 shrink-0">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#28ca41]" />
                </div>
                <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.18em] ml-1">
                  Terminal
                </p>
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              </div>
              <ScrollArea className="flex-1 p-4 font-mono text-[11px] leading-relaxed bg-black/60">
                <div className="space-y-1.5">
                  {consoleLogs.map((log, i) => {
                    const isError = log.includes("❌") || log.includes("🛑");
                    const isSuccess = log.includes("✅") || log.includes("🎉");
                    const isWarning = log.includes("⚠️") || log.includes("🔄");
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex gap-3 items-start",
                          isError && "text-red-400",
                          isSuccess && "text-emerald-400",
                          isWarning && "text-amber-400",
                          !isError &&
                            !isSuccess &&
                            !isWarning &&
                            "text-white/30",
                        )}
                      >
                        <span className="text-white/15 shrink-0 tabular-nums">
                          {String(i).padStart(3, "0")}
                        </span>
                        <span className="break-all">{log}</span>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
