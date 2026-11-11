import {useEffect,useState,type CSSProperties} from "react";
import {posterDisplayMode} from "./posterFraming";

/** Fit common posters edge-to-edge. A very unusual aspect ratio retains its
 * complete primary image over a blurred extension: no empty strips, no huge cut.
 */
export function AdaptivePoster({src,alt,frameRatio=2/3,className="",priority=false,onNaturalRatio}:{
  src?:string;
  alt:string;
  frameRatio?:number;
  className?:string;
  priority?:boolean;
  onNaturalRatio?:(ratio:number)=>void;
}){
  const [naturalRatio,setNaturalRatio]=useState<number|null>(null);
  useEffect(()=>setNaturalRatio(null),[src]);
  const mode=naturalRatio===null?"cover":posterDisplayMode(naturalRatio,frameRatio);
  const style={"--v3-adaptive-frame-ratio":String(frameRatio)} as CSSProperties;
  return <span className={`v3-adaptive-poster ${className} ${mode==="backdrop"?"is-extreme":""}`}
    style={style}>
    {src?<>
      {mode==="backdrop"&&<img className="v3-adaptive-poster-backdrop" src={src} alt=""
        aria-hidden="true" loading="lazy"/>}
      <img className="v3-adaptive-poster-image" src={src} alt={alt}
        loading={priority?"eager":"lazy"} decoding="async"
        onLoad={event=>{
          const image=event.currentTarget;
          if(image.naturalWidth>0&&image.naturalHeight>0){
            const ratio=image.naturalWidth/image.naturalHeight;
            setNaturalRatio(ratio);
            onNaturalRatio?.(ratio);
          }
        }}/>
    </>:<span className="v3-adaptive-poster-empty">暂无海报</span>}
  </span>;
}
