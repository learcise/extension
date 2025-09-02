// import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, 
  // useMemo

 } from "react";
// import { motion, AnimatePresence } from "framer-motion";
import * as poseDetection from "@tensorflow-models/pose-detection";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import viteLogo from '/vite.svg'
import './App.css'

/**
 * ページに Shadow DOM でマウントポイントを作って React を差し込む
 */
function mount() {
  // 既に挿入済みならスキップ
  if (document.getElementById('my-ext-container')) return

  // コンテナ作成
  const host = document.createElement('div')
  host.id = 'my-ext-container'
  host.style.all = 'initial' // 念のため（Shadowと併用）
  host.style.position = 'fixed'
  host.style.bottom = '16px'
  host.style.right = '16px'
  host.style.zIndex = '2147483647' // 一番上

  // Shadow DOM
  const shadow = host.attachShadow({ mode: 'open' })
  const appRoot = document.createElement('div')
  shadow.appendChild(appRoot)

  // ページへ追加
  document.documentElement.appendChild(host)

  // React マウント
  const root = createRoot(appRoot)
  root.render(<App />)
}

// eslint-disable-next-line react-refresh/only-export-components
function App() {
    const previousTwistRef = useRef<"left" | "right" | "center" | null>("center");
  const twistCooldownRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const isDetectionPausedRef = useRef(false);
  // const currentPositionRef = useRef({ x: 0, y: 0 });
  const previousArmRef = useRef<"up" | "down" | null>(null);
  const armCooldownRef = useRef(false);
  const isArmRaisedRef = useRef(false);
  const previousGasshoRef = useRef<"gassho" | "open" | null>(null);
  const gasshoCooldownRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  // const [isVideoMode, setIsVideoMode] = useState(false);
  const [kcal, setKcal] = useState(0);

  // --- Pose helpers ---
function isArmVertical(wrist: poseDetection.Keypoint, shoulder: poseDetection.Keypoint): boolean {
  const vertical = (shoulder.y - wrist.y) > 40;
  const nearX = Math.abs(shoulder.x - wrist.x) < 120;
  return vertical && nearX;
}

    type KP = poseDetection.Keypoint & { name?: string };
  const kp = (points: KP[], name: string) => points.find(k => (k as any).name === name);
  const dist = (a: KP, b: KP) => Math.hypot(a.x - b.x, a.y - b.y);

    const isGassho = (points: KP[]): boolean => {
    const lw = kp(points, "left_wrist");
    const rw = kp(points, "right_wrist");
    const ls = kp(points, "left_shoulder");
    const rs = kp(points, "right_shoulder");
    const le = kp(points, "left_elbow");
    const re = kp(points, "right_elbow");
    const nose = kp(points, "nose");
    if (!lw || !rw || !ls || !rs || !le || !re || !nose) return false;

    const shoulderWidth = dist(ls, rs);
    if (!shoulderWidth || !isFinite(shoulderWidth)) return false;

    const wristsClose = dist(lw, rw) / shoulderWidth < 0.25;
    const wristsLevel = Math.abs(lw.y - rw.y) / shoulderWidth < 0.12;
    const minShoulderX = Math.min(ls.x, rs.x);
    const maxShoulderX = Math.max(ls.x, rs.x);
    const inBetweenShoulders =
      lw.x >= minShoulderX && lw.x <= maxShoulderX &&
      rw.x >= minShoulderX && rw.x <= maxShoulderX;
    const elbowsBelowHands = le.y > lw.y && re.y > rw.y;
    const shoulderY = (ls.y + rs.y) / 2;
    const upperBand = nose.y + 0.40 * shoulderWidth;
    const lowerBand = shoulderY + 0.60 * shoulderWidth;
    const wristsAtChest =
      lw.y >= upperBand && lw.y <= lowerBand &&
      rw.y >= upperBand && rw.y <= lowerBand;

    return wristsClose && wristsLevel && inBetweenShoulders && elbowsBelowHands && wristsAtChest;
  };




    // --- Pose: enable / disable ---
  useEffect(() => {
    if (!enabled) {
      // 終了処理
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      if (detectorRef.current) { detectorRef.current.dispose(); detectorRef.current = null; }
      // setIsVideoMode(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      await tf.setBackend("webgl");
      // Camera
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true; (video as any).playsInline = true; await video.play();
      videoRef.current = video; streamRef.current = stream; 
      // setIsVideoMode(true);

      // Detector
      const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType: (poseDetection as any).movenet.modelType.SINGLEPOSE_LIGHTNING }
      );
      detectorRef.current = detector;

      const detectPose = async () => {
        if (cancelled || !videoRef.current || !detectorRef.current) return;
        if (isDetectionPausedRef.current) {
          animationFrameRef.current = requestAnimationFrame(detectPose);
          return;
        }
        if (videoRef.current.readyState === 4) {
          const poses = await detectorRef.current.estimatePoses(videoRef.current);
          if (poses.length > 0) {
            const keypoints = poses[0].keypoints as poseDetection.Keypoint[];
            const get = (name: string) => keypoints.find(k => (k as any).name === name);
            const rw = get("right_wrist");
            const rs = get("right_shoulder");
            const lw = get("left_wrist");
            const ls = get("left_shoulder");
            const nose = get("nose");

            // 腕の状態検出
            const isRightVertical = rw && rs ? isArmVertical(rw, rs) : false;
            const isLeftVertical = lw && ls ? isArmVertical(lw, ls) : false;
            const bothUp = isRightVertical && isLeftVertical;
            // const pos = currentPositionRef.current;

            const currentArmState: "up" | "down" = bothUp ? "up" : "down";
            const prevArm = previousArmRef.current;
            if ((prevArm === "down" || prevArm === null) && currentArmState === "up" && !armCooldownRef.current) {
              // 両腕を上げたら「選択枠を一段上に」
              // const nextX = pos.x - 1 < 0 ? rows - 1 : pos.x - 1; // wrap
              // moveSelectionTo(nextX, pos.y);
              console.log("両腕を上げた");
              setKcal((prev)=> prev+0.1)
              armCooldownRef.current = true;
              setTimeout(() => { armCooldownRef.current = false; }, 500);
              
            }
            if (prevArm === "up" && currentArmState === "down") {
              if (isArmRaisedRef.current) {
                isArmRaisedRef.current = false;
              }
            }

            // 腰のひねり → 左右移動
            if (ls && rs && nose && !twistCooldownRef.current) {
              const chestX = (ls.x + rs.x) / 2;
              const offset = nose.x - chestX;
              const threshold = 70;
              let currentTwist: "left" | "right" | "center";
              if (offset > threshold) currentTwist = "right";
              else if (offset < -threshold) currentTwist = "left";
              else currentTwist = "center";
              const prev = previousTwistRef.current;
              if ((prev === "center" || prev === null) && (currentTwist === "left" || currentTwist === "right")) {
                // if (currentTwist === "left") moveSelectionTo(pos.x, (pos.y + 1) % cols);
                // if (currentTwist === "right") moveSelectionTo(pos.x, (pos.y - 1 + cols) % cols);
                twistCooldownRef.current = true;
                setTimeout(() => { twistCooldownRef.current = false; }, 500);
              }
              previousTwistRef.current = currentTwist;
            }

            previousArmRef.current = currentArmState;

            // --- 合掌で「選択枠タイルのクリック相当」を実行 ---
            const detectedGassho = isGassho(keypoints as any);
            const prevG = previousGasshoRef.current;

            if ((prevG === "open" || prevG === null) && detectedGassho && !gasshoCooldownRef.current) {
              // クリックと同等: 「選択されているタイルのみ動かす」
              // const x = currentPositionRef.current.x;
              // const y = currentPositionRef.current.y;
              gasshoCooldownRef.current = true;
              setTimeout(() => { gasshoCooldownRef.current = false; }, 800);
            }
            previousGasshoRef.current = detectedGassho ? "gassho" : "open";
          }
        }
        animationFrameRef.current = requestAnimationFrame(detectPose);
      };

      detectPose();
    };

    run();

    return () => {
      cancelled = true;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      if (detectorRef.current) { detectorRef.current.dispose(); detectorRef.current = null; }
      // setIsVideoMode(false);
    };
  }, [enabled]); // size も依存に追加（選択 index 計算の正確性向上）

  return (
    <>
      <div>
        {kcal.toFixed(1)} kcal
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setEnabled(e => !e)}>
          {enabled ? 'Disable Pose Detection' : 'Enable Pose Detection'}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )    
}

// DOM 準備できたら実行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  mount()
}
