import type {CameraDirection} from './camera.ts';

export function setupCameraUI(turn:(direction:CameraDirection)=>void,setElevation:(degrees:number)=>void){
  const toggle=document.querySelector<HTMLButtonElement>('#camera-toggle')!;
  const panel=document.querySelector<HTMLElement>('#camera-panel')!;
  const close=()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');};
  toggle.onclick=()=>{
    panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));
  };
  panel.querySelectorAll<HTMLButtonElement>('[data-camera-direction]').forEach(button=>{
    button.onclick=()=>turn(button.dataset.cameraDirection as CameraDirection);
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-camera-elevation]').forEach(button=>{
    button.onclick=()=>setElevation(Number(button.dataset.cameraElevation));
  });
  panel.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();toggle.focus({preventScroll:true});}
  });
  document.querySelector('#reset-camera')!.addEventListener('click',close);
}
