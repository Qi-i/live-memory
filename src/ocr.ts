type OcrProgress = (progress: number, status: string) => void;

type TesseractWorker = {
  recognize: (image: File | Blob | string) => Promise<{ data: { text?: string } }>;
  terminate: () => Promise<unknown>;
};

type TesseractApi = {
  createWorker: (
    languages?: string,
    oem?: number,
    options?: { logger?: (message: { status?: string; progress?: number }) => void },
  ) => Promise<TesseractWorker>;
};

declare global {
  interface Window {
    Tesseract?: TesseractApi;
  }
}

const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
let loader: Promise<TesseractApi> | null = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (loader) return loader;
  loader = new Promise<TesseractApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TESSERACT_CDN}"]`);
    const script = existing || document.createElement("script");
    const finish = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("截图识别组件加载失败"));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("截图识别组件加载失败，请检查网络")), { once: true });
    if (!existing) {
      script.src = TESSERACT_CDN;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
  });
  return loader;
}

export async function recognizeTicketScreenshot(file: File, onProgress?: OcrProgress) {
  if (!file.type.startsWith("image/")) throw new Error("请选择演出页面截图图片");
  onProgress?.(0.02, "正在加载识别组件");
  const tesseract = await loadTesseract();
  const worker = await tesseract.createWorker("chi_sim+eng", 1, {
    logger(message) {
      const progress = typeof message.progress === "number" ? message.progress : 0;
      onProgress?.(Math.max(0.03, Math.min(0.98, progress)), message.status || "正在识别截图");
    },
  });
  try {
    const result = await worker.recognize(file);
    const text = String(result.data.text || "").trim();
    if (!text) throw new Error("截图中没有识别到可用文字");
    onProgress?.(1, "识别完成");
    return text;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
