/**
 * ffmpeg graph: inputs 0 = base run, 1 = other run, 2 = template. Where the other run differs from the
 * template clearly more than the base run does, the picture comes from the other run.
 * The difference is measured at 1/4 size on luma, blurred (a region, not single pixels), steadied over
 * 5 frames and softened at the edge.
 */
export function mergeGraph(W: number, H: number, fps: number): string {
  const w = Math.max(16, Math.round(W / 8) * 2), h = Math.max(16, Math.round(H / 8) * 2);
  const norm = (i: number, name: string) => `[${i}:v]fps=${fps},scale=${W}:${H},setsar=1,format=yuv420p,setpts=PTS-STARTPTS[${name}]`;
  return [
    norm(0, "a0"), norm(1, "b0"), norm(2, "t0"),
    "[a0]split[a][ad]", "[b0]split[b][bd]", "[t0]split[t1][t2]",
    `[ad]scale=${w}:${h},format=gray[as]`, `[bd]scale=${w}:${h},format=gray[bs]`,
    `[t1]scale=${w}:${h},format=gray[ts1]`, `[t2]scale=${w}:${h},format=gray[ts2]`,
    "[as][ts1]blend=all_mode=difference,gblur=sigma=5[da]",
    "[bs][ts2]blend=all_mode=difference,gblur=sigma=5[db]",
    "[db][da]blend=all_expr='if(gt(A\\,B+6)\\,255\\,0)',tmix=frames=5,gblur=sigma=3," + `scale=${W}:${H},format=gray[m]`,
    "[b][m]alphamerge[bm]",
    "[a][bm]overlay=shortest=1:format=auto,format=yuv420p[v]",
  ].join(";");
}
