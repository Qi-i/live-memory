import {AdaptivePoster} from "./AdaptivePoster";

export interface FeaturedPoster {
  id:string;
  title:string;
  city?:string;
  src?:string;
}

/** A finite selection: no carousel, blank margins or false demo media. */
export function V3FeaturedHero({posters,onBrowse,frameRatio,onNaturalRatio}:{
  posters:readonly FeaturedPoster[];
  onBrowse:()=>void;
  frameRatio?:number;
  onNaturalRatio?:(id:string,ratio:number)=>void;
}){
  return <section className="v3-real-featured" aria-label="精选现场">
    <div className="v3-real-featured-copy">
      <span>LIVE MEMORY · YOUR MOMENTS</span>
      <h1>每一场，都值得珍藏</h1>
      <p>你的演出档案，自动精选不同艺人的现场海报。</p>
      <button type="button" onClick={onBrowse}>浏览全部档案 <span aria-hidden="true">↗</span></button>
    </div>
    <div className="v3-real-featured-gallery" aria-label={`精选 ${posters.length} 张不同艺人的海报`}>
      {posters.length?posters.slice(0,5).map((poster,index)=><figure
        className="v3-real-featured-card" key={poster.id} title={poster.title}>
        <AdaptivePoster className="v3-real-featured-image" src={poster.src}
          alt={poster.title+"海报"} priority={index<3} frameRatio={frameRatio}
          onNaturalRatio={ratio=>onNaturalRatio?.(poster.id,ratio)}/>
        <figcaption>{poster.title}{poster.city?" · "+poster.city:""}</figcaption>
      </figure>):<p className="v3-real-featured-empty">添加演出海报后，这里会自动呈现精选现场。</p>}
    </div>
  </section>;
}
