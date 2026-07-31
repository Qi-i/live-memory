import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppSettings, EventRecord } from "./domain";
import { categoryLabels } from "./domain";
import {
  fetchAdminOverview,
  fetchAdminStorageBreakdown,
  fetchAdminTrends,
  fetchAdminVisitorStats,
} from "./supabase";
import type {
  AdminOverview,
  AdminStorageRow,
  AdminTrendRow,
  AdminVisitorStats,
} from "./supabase";

export function StatsPage({ records }: { records: EventRecord[] }) {
  const watched = records.filter((record) => record.status === "watched");
  const planned = records.filter((record) => record.status !== "watched");
  const totalPrice = watched.reduce((sum, record) => sum + (record.price || 0), 0);
  const averagePrice = Math.round(totalPrice / Math.max(1, watched.filter((record) => record.price).length));
  const years = unique(records.map((record) => record.date.slice(0, 4))).sort();
  const monthly = useMemo(() => countRows(watched.map((record) => record.date.slice(0, 7)), 12), [watched]);
  const artists = useMemo(() => countRows(records.flatMap((record) => record.artists), 10), [records]);
  const cities = useMemo(() => countRows(records.map((record) => record.city).filter(Boolean), 10), [records]);
  const categories = useMemo(() => countRows(records.map((record) => categoryLabels[record.category]), 10), [records]);

  return (
    <section className="statistics-page">
      <div className="statistics-metrics">
        <Metric value={records.length} label="总记录" hint={years.length ? `${years[0]}—${years[years.length - 1]}` : "尚无档案"} />
        <Metric value={watched.length} label="已看" hint="完成观演" accent />
        <Metric value={planned.length} label="待看/想看" hint="未来计划" />
        <Metric value={`¥${totalPrice}`} label="累计票价" hint={`均价 ¥${averagePrice || 0}`} accent />
      </div>

      <div className="statistics-grid">
        <BarPanel title="每月观演" description="最近 12 个有记录的月份" rows={monthly} />
        <BarPanel title="常看艺人" description="按档案出现次数统计" rows={artists} />
        <BarPanel title="城市足迹" description="现场发生在哪些城市" rows={cities} />
        <BarPanel title="演出类型" description="档案类型结构" rows={categories} />
      </div>

      <section className="statistics-story">
        <span>MEMORY PROFILE</span>
        <h2>{profileSentence(records, watched, cities, artists)}</h2>
        <p>统计页只解释你的档案，不重复档案页的筛选和导航。所有数据均来自当前记录。</p>
      </section>
    </section>
  );
}

function Metric({ value, label, hint, accent }: { value: string | number; label: string; hint: string; accent?: boolean }) {
  return <article className={accent ? "is-accent" : ""}><span>{label}</span><strong>{value}</strong><em>{hint}</em></article>;
}

function BarPanel({ title, description, rows }: { title: string; description: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, count]) => count));
  return (
    <article className="statistics-panel">
      <header><span>{description}</span><h2>{title}</h2></header>
      <div>{rows.length ? rows.map(([label, count]) => <p key={label}><span>{label}</span><i><b style={{ width: `${count / max * 100}%` }} /></i><strong>{count}</strong></p>) : <em className="statistics-empty">暂无可统计数据</em>}</div>
    </article>
  );
}

function profileSentence(records: EventRecord[], watched: EventRecord[], cities: [string, number][], artists: [string, number][]) {
  if (!records.length) return "你的现场画像会随着档案逐渐形成。";
  const city = cities[0]?.[0] || "不同城市";
  const artist = artists[0]?.[0] || "不同艺人";
  return `你已经完成 ${watched.length} 次现场记忆，最常抵达 ${city}，档案中出现最多的是 ${artist}。`;
}

export function AdminPage({ settings }: { settings: AppSettings }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [trends, setTrends] = useState<AdminTrendRow[]>([]);
  const [storage, setStorage] = useState<AdminStorageRow[]>([]);
  const [visitors, setVisitors] = useState<AdminVisitorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchAdminOverview(settings),
      fetchAdminTrends(settings),
      fetchAdminStorageBreakdown(settings),
      fetchAdminVisitorStats(settings),
    ]).then(([nextOverview, nextTrends, nextStorage, nextVisitors]) => {
      if (!active) return;
      setOverview(nextOverview);
      setTrends(nextTrends);
      setStorage(nextStorage);
      setVisitors(nextVisitors);
      setError("");
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "管理数据加载失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [settings]);

  if (loading) return <section className="admin-state"><Loader2 className="spin" /><strong>正在加载管理数据</strong></section>;
  if (error) return <section className="admin-state is-error"><strong>管理面板暂不可用</strong><p>{error}</p></section>;

  return (
    <section className="admin-page-v2">
      <div className="statistics-metrics">
        <Metric value={overview?.total_users || 0} label="注册用户" hint={`${overview?.active_users || 0} 位活跃`} accent />
        <Metric value={overview?.total_records || 0} label="演出记录" hint="账号文字备份" />
        <Metric value={overview?.total_media || 0} label="媒体资源" hint="云端图片索引" />
        <Metric value={visitors?.total_views || 0} label="页面访问" hint={`${visitors?.unique_paths || 0} 个路径`} accent />
      </div>
      <div className="statistics-grid">
        <BarPanel title="新用户趋势" description="最近 30 天" rows={trends.map((row) => [row.day.slice(5), row.new_users])} />
        <BarPanel title="新记录趋势" description="最近 30 天" rows={trends.map((row) => [row.day.slice(5), row.new_records])} />
        <BarPanel title="用户存储" description="记录与媒体总量" rows={storage.map((row) => [row.display_name || row.username, row.record_count + row.media_count])} />
        <BarPanel title="热门页面" description="按访问次数" rows={(visitors?.top_paths || []).map((row) => [row.path, row.count])} />
      </div>
    </section>
  );
}

function countRows(values: string[], limit: number): [string, number][] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function unique<T extends string>(values: T[]) { return Array.from(new Set(values.filter(Boolean))); }
