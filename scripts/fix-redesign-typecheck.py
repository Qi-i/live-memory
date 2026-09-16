from pathlib import Path

root = Path(__file__).resolve().parents[1]

p = root / "src/appController.ts"
s = p.read_text(encoding="utf-8")
s = s.replace('  }, [access.user, isGuest, settings.accountBackup.enabled, settings.supabase.ownerKey, settings.supabase.url]);', '  }, [access.user, isGuest, settings.supabase.ownerKey, settings.supabase.url]);')
p.write_text(s, encoding="utf-8")

p = root / "src/archive.tsx"
s = p.read_text(encoding="utf-8")
s = s.replace('import { loadAmap } from "./amap";', 'import { loadAmap, type AMapMapInstance } from "./amap";')
s = s.replace('    let instance: { destroy: () => void; add?: (items: unknown) => void; setFitView?: (...args: unknown[]) => void } | null = null;', '    let instance: AMapMapInstance | null = null;')
s = s.replace('        instance = new AMap.Map(hostRef.current, { center: [104.2, 35.8], zoom: 4.1, viewMode: "2D", resizeEnable: true });', '        const map = new AMap.Map(hostRef.current, { center: [104.2, 35.8], zoom: 4.1, viewMode: "2D", resizeEnable: true });\n        instance = map;')
s = s.replace('        instance.add?.(markers);\n        if (markers.length) instance.setFitView?.(markers, false, [70, 70, 70, 70], 11);', '        map.add?.(markers);\n        if (markers.length) map.setFitView?.(markers, false, [70, 70, 70, 70], 11);')
p.write_text(s, encoding="utf-8")

print("Fixed redesign TypeScript errors")
