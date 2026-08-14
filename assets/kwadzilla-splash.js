/*!
 * KWADZILLA — coming soon
 *
 * A monitor lizard, alive, on a white seamless backdrop. Zero dependencies,
 * one file, no network requests: the animal is generated as geometry at
 * startup (spine, limbs, toes, claws, eyes, tongue), skinned to a bone
 * chain, and lit like a studio photograph.
 *
 * The only thing a visitor can touch is its attention. The head and eyes
 * follow the cursor; on a phone they follow the phone, so tilting the
 * handset keeps the animal looking straight back at you. Everything else
 * it does — breathing, blinking, tongue flicks, the tail, the slow shift
 * of weight from foot to foot — it does on its own.
 *
 * Mount by putting an element with [data-kwadzilla-soon] on the page. The
 * canvas is injected from here, so a visitor without JS or without WebGL2
 * keeps the plain white page and the wordmark rather than an empty box.
 *
 * Layout:
 *   1. maths            vectors, quaternions, matrices, noise, splines
 *   2. gl helpers       shader/program/buffer/texture/framebuffer plumbing
 *   3. anatomy          the numbers that describe the animal
 *   4. rig              bone chains and forward kinematics
 *   5. meshing          rings swept along the chains, welded and normalled
 *   6. shaders          skin, backdrop, scale bake, post
 *   7. behaviour        idle life, gaze, blinks, flicks
 *   8. renderer         the frame loop
 *   9. mount            DOM wiring, input, accessibility, teardown
 */
(function () {
  'use strict';

  /* ================================================================== */
  /* 1. Maths                                                            */
  /* ================================================================== */

  var PI = Math.PI;
  var TAU = PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sat(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function smoothstep(e0, e1, x) {
    var t = sat((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  }

  function v3(x, y, z) { return [x || 0, y || 0, z || 0]; }
  function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function v3mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function v3len(a) { return Math.sqrt(v3dot(a, a)); }
  function v3lerp(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  function v3norm(a) {
    var l = v3len(a);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  }

  function v3cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  /* Quaternions are [x, y, z, w]. */

  function qid() { return [0, 0, 0, 1]; }

  function qmul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
  }

  function qconj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

  function qrot(q, v) {
    var t = v3mul(v3cross([q[0], q[1], q[2]], v), 2);
    return v3add(v3add(v, v3mul(t, q[3])), v3cross([q[0], q[1], q[2]], t));
  }

  function qAxis(axis, ang) {
    var h = ang * 0.5, s = Math.sin(h);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
  }

  function qnorm(q) {
    var l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    return l > 1e-9 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : qid();
  }

  /* Shortest rotation taking unit vector a onto unit vector b. */
  function qFromTo(a, b) {
    var d = v3dot(a, b);
    if (d > 0.999999) return qid();
    if (d < -0.999999) {
      var ax = v3cross([1, 0, 0], a);
      if (v3len(ax) < 1e-6) ax = v3cross([0, 1, 0], a);
      return qAxis(v3norm(ax), PI);
    }
    var c = v3cross(a, b);
    return qnorm([c[0], c[1], c[2], 1 + d]);
  }

  /* Quaternion from an orthonormal basis given as its three column axes. */
  function qFromBasis(x, y, z) {
    var m00 = x[0], m10 = x[1], m20 = x[2];
    var m01 = y[0], m11 = y[1], m21 = y[2];
    var m02 = z[0], m12 = z[1], m22 = z[2];
    var tr = m00 + m11 + m22, s;
    if (tr > 0) {
      s = Math.sqrt(tr + 1) * 2;
      return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
    }
    if (m00 > m11 && m00 > m22) {
      s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
    }
    if (m11 > m22) {
      s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
    }
    s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }

  /* Column-major 4x4, the layout WebGL wants. */

  function mIdent(o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  }

  function mMul(o, a, b) {
    var t = new Float32Array(16), i, j, k, s;
    for (i = 0; i < 4; i++) {
      for (j = 0; j < 4; j++) {
        s = 0;
        for (k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        t[i * 4 + j] = s;
      }
    }
    o.set(t);
    return o;
  }

  function mPerspective(o, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy * 0.5), nf = 1 / (near - far);
    mIdent(o);
    o[0] = f / aspect; o[5] = f;
    o[10] = (far + near) * nf; o[11] = -1;
    o[14] = 2 * far * near * nf; o[15] = 0;
    return o;
  }

  function mLookAt(o, eye, at, up) {
    var z = v3norm(v3sub(eye, at));
    var x = v3norm(v3cross(up, z));
    var y = v3cross(z, x);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -v3dot(x, eye); o[13] = -v3dot(y, eye); o[14] = -v3dot(z, eye); o[15] = 1;
    return o;
  }

  function mFromRT(o, q, t) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2;
    var yy = y * y2, yz = y * z2, zz = z * z2;
    var wx = w * x2, wy = w * y2, wz = w * z2;
    o[0] = 1 - (yy + zz); o[1] = xy + wz; o[2] = xz - wy; o[3] = 0;
    o[4] = xy - wz; o[5] = 1 - (xx + zz); o[6] = yz + wx; o[7] = 0;
    o[8] = xz + wy; o[9] = yz - wx; o[10] = 1 - (xx + yy); o[11] = 0;
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
    return o;
  }

  /* Normal matrix for a rotation-only model matrix is just its upper 3x3. */
  function mNormal3(o, m) {
    o[0] = m[0]; o[1] = m[1]; o[2] = m[2];
    o[3] = m[4]; o[4] = m[5]; o[5] = m[6];
    o[6] = m[8]; o[7] = m[9]; o[8] = m[10];
    return o;
  }

  /* Cheap deterministic value noise. Used for the animal's micro-motion,
     where reproducibility matters more than spectral quality. */
  function hash1(n) {
    var s = Math.sin(n * 127.1) * 43758.5453123;
    return s - Math.floor(s);
  }

  function noise1(x, seed) {
    var i = Math.floor(x), f = x - i;
    var u = f * f * (3 - 2 * f);
    var a = hash1(i + seed * 57.31), b = hash1(i + 1 + seed * 57.31);
    return lerp(a, b, u) * 2 - 1;
  }

  function fbm1(x, seed) {
    return noise1(x, seed) * 0.60 +
      noise1(x * 2.17 + 3.7, seed + 11) * 0.27 +
      noise1(x * 4.61 + 9.1, seed + 23) * 0.13;
  }

  /* Catmull-Rom through a list of points, sampled by arc length. */
  function Spline(pts) {
    this.pts = pts;
    this.samples = [];
    this.arc = [];
    var N = 24 * (pts.length - 1);
    var prev = null, total = 0, i;
    for (i = 0; i <= N; i++) {
      var p = this._raw(i / N);
      if (prev) total += v3len(v3sub(p, prev));
      this.samples.push(p);
      this.arc.push(total);
      prev = p;
    }
    this.length = total;
  }

  Spline.prototype._raw = function (t) {
    var n = this.pts.length - 1;
    var f = t * n;
    var i = clamp(Math.floor(f), 0, n - 1);
    var lt = f - i;
    var p0 = this.pts[Math.max(0, i - 1)];
    var p1 = this.pts[i];
    var p2 = this.pts[i + 1];
    var p3 = this.pts[Math.min(n, i + 2)];
    var t2 = lt * lt, t3 = t2 * lt, o = [0, 0, 0], k;
    for (k = 0; k < 3; k++) {
      o[k] = 0.5 * ((2 * p1[k]) +
        (-p0[k] + p2[k]) * lt +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    }
    return o;
  };

  /* Position at arc length s (0 .. this.length). */
  Spline.prototype.at = function (s) {
    s = clamp(s, 0, this.length);
    var lo = 0, hi = this.arc.length - 1, mid;
    while (lo < hi - 1) {
      mid = (lo + hi) >> 1;
      if (this.arc[mid] <= s) lo = mid; else hi = mid;
    }
    var a = this.arc[lo], b = this.arc[hi];
    var t = b > a ? (s - a) / (b - a) : 0;
    return v3lerp(this.samples[lo], this.samples[hi], t);
  };

  /* Piecewise-linear table lookup, used for every anatomical profile. */
  function tableAt(tbl, u) {
    if (u <= tbl[0][0]) return tbl[0];
    var n = tbl.length;
    if (u >= tbl[n - 1][0]) return tbl[n - 1];
    var i = 0;
    while (i < n - 2 && tbl[i + 1][0] < u) i++;
    var a = tbl[i], b = tbl[i + 1];
    var t = (u - a[0]) / (b[0] - a[0]);
    t = t * t * (3 - 2 * t);
    var out = [u], k;
    for (k = 1; k < a.length; k++) out.push(lerp(a[k], b[k], t));
    return out;
  }

  /* ================================================================== */
  /* 2. GL helpers                                                       */
  /* ================================================================== */

  function compile(gl, type, src, label) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('kwadzilla: ' + label + ' failed to compile\n' + log);
    }
    return sh;
  }

  function program(gl, vsSrc, fsSrc, label) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc, label + ' vertex');
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + ' fragment');
    var pr = gl.createProgram();
    gl.attachShader(pr, vs);
    gl.attachShader(pr, fs);
    gl.linkProgram(pr);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(pr);
      gl.deleteProgram(pr);
      throw new Error('kwadzilla: ' + label + ' failed to link\n' + log);
    }
    /* Cache every uniform location up front — there are enough of them
       that per-frame getUniformLocation would show up in a profile. */
    pr.u = {};
    var n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS), i, info;
    for (i = 0; i < n; i++) {
      info = gl.getActiveUniform(pr, i);
      var name = info.name.replace(/\[0\]$/, '');
      pr.u[name] = gl.getUniformLocation(pr, info.name);
    }
    return pr;
  }

  /* ================================================================== */
  /* 3. Anatomy                                                          */
  /* ================================================================== */
  /*
   * All of it in metres, for an adult monitor of about 1.6 m nose to tail
   * tip: a 17 cm head, a 15 cm neck, a 42 cm trunk and an 86 cm tail. The
   * numbers are the model — get them right and the shading has something
   * true to sit on.
   *
   * Model space: +X is forward (out of the snout), +Y is up, +Z is the
   * animal's left. The floor is y = 0.
   */

  var HEAD_LEN = 0.170;
  var NECK_LEN = 0.150;
  var TRUNK_LEN = 0.420;
  var TAIL_LEN = 0.860;

  /* Bones per region. The head gets a disproportionate share: it is the
     part that moves under gaze and the part everybody looks at. */
  var NB_HEAD = 26;
  var NB_NECK = 20;
  var NB_TRUNK = 18;
  var NB_TAIL = 26;
  var RAD_SEG = 40;              // ring resolution around the body

  /* The resting line of the spine, nose first. */
  var SPINE_PTS = [
    [0.668, 0.257, 0.000],   // snout tip
    [0.612, 0.259, 0.000],
    [0.568, 0.262, 0.000],
    [0.532, 0.266, 0.000],   // eyes
    [0.500, 0.266, 0.000],   // back of skull
    [0.468, 0.261, 0.001],
    [0.430, 0.247, 0.003],   // neck
    [0.392, 0.228, 0.004],
    [0.348, 0.204, 0.003],   // shoulders
    [0.288, 0.189, 0.004],
    [0.200, 0.182, 0.008],
    [0.100, 0.179, 0.010],   // mid trunk
    [0.000, 0.179, 0.008],
    [-0.075, 0.181, 0.002],  // hips
    [-0.155, 0.174, -0.008],
    [-0.320, 0.146, -0.022], // tail
    [-0.500, 0.108, -0.031],
    [-0.675, 0.073, -0.021],
    [-0.830, 0.047, 0.012],
    [-0.945, 0.033, 0.058],
    [-1.005, 0.026, 0.112]   // tail tip
  ];
  /* Half-width (lateral) and half-height (dorsoventral) against arc
     fraction. The trunk is wider than tall — a sprawling animal — and the
     tail is the other way round, compressed into a swimming blade. */
  var GIRTH = [
    /* u,      halfW,  halfH,  superellipse n */
    [0.000, 0.0064, 0.0072, 2.40],
    [0.014, 0.0138, 0.0150, 2.60],
    [0.036, 0.0176, 0.0186, 2.62],
    [0.060, 0.0206, 0.0214, 2.55],
    [0.076, 0.0252, 0.0250, 2.38],
    [0.088, 0.0356, 0.0320, 2.24],
    [0.097, 0.0496, 0.0404, 2.20],
    [0.104, 0.0478, 0.0376, 2.15],
    [0.114, 0.0384, 0.0348, 2.12],
    [0.132, 0.0388, 0.0378, 2.10],
    [0.150, 0.0432, 0.0450, 2.15],
    [0.200, 0.0690, 0.0660, 2.25],
    [0.240, 0.0910, 0.0830, 2.40],
    [0.300, 0.0995, 0.0885, 2.45],
    [0.370, 0.1015, 0.0895, 2.45],
    [0.430, 0.0945, 0.0860, 2.40],
    [0.463, 0.0880, 0.0835, 2.30],
    [0.520, 0.0690, 0.0800, 2.15],
    [0.600, 0.0520, 0.0690, 2.05],
    [0.700, 0.0360, 0.0540, 2.00],
    [0.800, 0.0230, 0.0390, 2.00],
    [0.900, 0.0130, 0.0235, 2.00],
    [0.960, 0.0062, 0.0125, 2.00],
    [1.000, 0.0016, 0.0038, 2.00]
  ];
  /* Scale size in metres against arc fraction: fine granules on the head,
     coarser shields down the flanks, big rectangular scutes on the belly. */
  var SCALE_SIZE = [
    [0.000, 0.0026],
    [0.106, 0.0030],
    [0.200, 0.0040],
    [0.400, 0.0058],
    [0.560, 0.0056],
    [0.800, 0.0042],
    [1.000, 0.0028]
  ];

  function girthAt(u) {
    var g = tableAt(GIRTH, u);
    return { w: g[1], h: g[2], n: g[3] };
  }

  /*
   * Radial displacement over the ring, in metres, positive outwards. This
   * is where the head stops being a tapered tube and starts being a skull:
   * brow ridges, the eye bulge, the jaw line, the lip crease, nostrils,
   * the ear opening, a loose throat. The tail gets its keel here too.
   *
   * u  — arc fraction along the body, 0 at the snout
   * th — angle around the ring, 0 at the spine, PI at the belly
   */
  function bumpAt(u, th) {
    var d = 0;
    /* Signed lateral angle: 0 on top, +/-PI/2 at the sides, PI beneath. */
    var a = th > PI ? TAU - th : th;      // 0..PI, mirrored across the flanks
    var side = Math.abs(a) / PI;          // 0 dorsal .. 1 ventral

    if (u < 0.125) {
      /* Brow ridge: a shelf over the eye, the single feature that makes a
         lizard look like it means something. */
      d += 0.0072 * Math.exp(-Math.pow((u - 0.0800) / 0.0150, 2)) *
        Math.exp(-Math.pow((a - 0.94) / 0.38, 2));
      /* Socket, with a raised ring of scales around it. The globe supplies
         the bulge; carving the skull to receive it is what makes the eye
         look set into a head rather than stuck onto one. */
      d -= 0.0062 * Math.exp(-Math.pow((u - 0.0805) / 0.0105, 2)) *
        Math.exp(-Math.pow((a - 1.26) / 0.26, 2));
      d += 0.0030 * Math.exp(-Math.pow((u - 0.0805) / 0.0185, 2)) *
        Math.exp(-Math.pow((a - 1.26) / 0.46, 2));
      /* Jaw flare behind the mouth line. */
      d += 0.0052 * Math.exp(-Math.pow((u - 0.0955) / 0.0155, 2)) *
        Math.exp(-Math.pow((a - 1.62) / 0.44, 2));
      /* Lip crease — the seam of a closed mouth, running the snout's length. */
      d -= 0.0038 * smoothstep(0.004, 0.014, u) * smoothstep(0.106, 0.088, u) *
        Math.exp(-Math.pow((a - 1.62) / 0.105, 2));
      /* Nostril. */
      d -= 0.0028 * Math.exp(-Math.pow((u - 0.0215) / 0.0055, 2)) *
        Math.exp(-Math.pow((a - 0.95) / 0.24, 2));
      /* Tympanum, the bare ear disc behind the jaw. */
      d -= 0.0034 * Math.exp(-Math.pow((u - 0.1035) / 0.0085, 2)) *
        Math.exp(-Math.pow((a - 1.50) / 0.30, 2));
      /* Flatten the top of the snout — it is a wedge, not a dome. */
      d -= 0.0030 * smoothstep(0.085, 0.035, u) * Math.exp(-Math.pow(a / 0.62, 2));
      /* Loose skin under the throat. */
      d += 0.0042 * smoothstep(0.028, 0.055, u) * smoothstep(0.118, 0.096, u) *
        smoothstep(0.55, 0.95, side);
    }

    /* Gular pouch and the folds where the neck meets the shoulders. */
    if (u > 0.100 && u < 0.235) {
      d += 0.0035 * smoothstep(0.105, 0.150, u) * smoothstep(0.230, 0.180, u) *
        smoothstep(0.50, 1.00, side);
      d -= 0.0022 * Math.exp(-Math.pow((u - 0.128) / 0.006, 2)) * (0.4 + 0.6 * side);
      d -= 0.0018 * Math.exp(-Math.pow((u - 0.160) / 0.006, 2)) * (0.4 + 0.6 * side);
    }

    /* A low ridge down the spine, all the way. */
    d += 0.0022 * Math.exp(-Math.pow(a / 0.30, 2)) * smoothstep(0.10, 0.24, u);

    /* Shoulder and haunch muscle. */
    d += 0.0058 * Math.exp(-Math.pow((u - 0.245) / 0.048, 2)) *
      Math.exp(-Math.pow((a - 1.15) / 0.72, 2));
    d += 0.0072 * Math.exp(-Math.pow((u - 0.452) / 0.055, 2)) *
      Math.exp(-Math.pow((a - 1.05) / 0.75, 2));

    /* The tail's keel, serrated by the ring of scales that raises it. */
    if (u > 0.480) {
      var keel = smoothstep(0.480, 0.585, u) * smoothstep(1.000, 0.870, u);
      d += keel * 0.0125 * (0.80 + 0.20 * Math.sin(u * 210)) *
        Math.exp(-Math.pow(a / 0.34, 2));
    }

    /* Belly plates sag a little between the limbs. */
    if (u > 0.250 && u < 0.450) {
      d += 0.0030 * Math.exp(-Math.pow((u - 0.350) / 0.075, 2)) *
        smoothstep(0.72, 1.00, side);
    }

    return d;
  }

  /* Limb control points, right side (+Z). Mirrored for the left.
     A sprawling stance: elbow and knee out wide, feet planted flat. */
  var FRONT_LEG = {
    pts: [
      [0.312, 0.178, 0.050],
      [0.303, 0.144, 0.102],
      [0.290, 0.104, 0.146],   // elbow
      [0.312, 0.068, 0.164],
      [0.338, 0.040, 0.172],   // wrist
      [0.360, 0.021, 0.176],
      [0.374, 0.013, 0.178]    // palm
    ],
    radii: [0.0360, 0.0330, 0.0272, 0.0215, 0.0176, 0.0160, 0.0146],
    toeBase: [0.374, 0.011, 0.178],
    toeLens: [0.036, 0.049, 0.056, 0.048, 0.031],
    toeYaw: [-0.95, -0.44, 0.02, 0.48, 0.98],
    toeR: 0.0082
  };
  var HIND_LEG = {
    pts: [
      [-0.078, 0.180, 0.048],
      [-0.094, 0.145, 0.106],
      [-0.110, 0.102, 0.158],  // knee
      [-0.084, 0.066, 0.174],
      [-0.052, 0.038, 0.182],  // ankle
      [-0.028, 0.020, 0.186],
      [-0.012, 0.013, 0.187]   // sole
    ],
    radii: [0.0460, 0.0415, 0.0325, 0.0245, 0.0192, 0.0174, 0.0156],
    toeBase: [-0.012, 0.011, 0.187],
    toeLens: [0.043, 0.062, 0.075, 0.066, 0.038],
    toeYaw: [-1.02, -0.50, 0.00, 0.46, 0.94],
    toeR: 0.0090
  };
  var EYE_R = 0.0118;           // globe radius
  var TONGUE_LEN = 0.105;

  /*
   * How far the animal is turned away from the lens. A wide frame gets the
   * flank; a tall one turns the animal towards the camera instead, because
   * a metre and a half of lizard laid across a phone in portrait is a
   * cropped tail and nothing else. The head has correspondingly less work
   * to do to look back, which is a happy accident rather than a plan.
   */
  var YAW_WIDE = -0.88;
  var YAW_TALL = -1.12;

  /* How much of the frame the animal should occupy, across and down.
     Vertical is the loose one: the wordmark lives above it. */
  var FILL_X_WIDE = 0.84, FILL_Y_WIDE = 0.58;
  var FILL_X_TALL = 0.84, FILL_Y_TALL = 0.46;
  var FOV = 30 * PI / 180;

  /* Direction from the subject to the camera. Length is irrelevant — the
     fit works out the distance. */
  var CAM_DIR = [0.055, 0.105, 1.0];


  /* Region ids, matched in the fragment shader. */
  var R_BODY = 0, R_HEAD = 1, R_TAIL = 2, R_LIMB = 3, R_TOE = 4,
    R_CLAW = 5, R_EYE = 6, R_LID = 7, R_TONGUE = 8, R_MOUTH = 9;

  /* ================================================================== */
  /* 4. Rig                                                              */
  /* ================================================================== */

  function Rig() {
    this.bones = [];
    this.order = null;
  }

  Rig.prototype.add = function (parent, pos, quat) {
    this.bones.push({
      parent: parent,
      restPos: pos,
      restQuat: quat,
      localPos: null,
      localQuat: null,
      /* animation slots, written every frame */
      aq: qid(),
      as: [1, 1, 1],
      /* results */
      P: pos.slice(),
      Q: quat.slice()
    });
    return this.bones.length - 1;
  };

  /* Rest transforms are authored in model space; forward kinematics needs
     them relative to the parent, so convert once and keep both. */
  Rig.prototype.bind = function () {
    var i, b, p;
    for (i = 0; i < this.bones.length; i++) {
      b = this.bones[i];
      if (b.parent < 0) {
        b.localPos = b.restPos.slice();
        b.localQuat = b.restQuat.slice();
      } else {
        p = this.bones[b.parent];
        var inv = qconj(p.restQuat);
        b.localPos = qrot(inv, v3sub(b.restPos, p.restPos));
        b.localQuat = qmul(inv, b.restQuat);
      }
      /*
       * The model's own axes, written in this bone's frame. Gaze has to
       * turn about these, not about the bone's local up: the neck slopes,
       * so its local up is tilted, and yawing about a tilted axis rears
       * the whole head skyward instead of turning it.
       */
      var back = qconj(b.restQuat);
      b.axX = qrot(back, [1, 0, 0]);
      b.axY = qrot(back, [0, 1, 0]);
      b.axZ = qrot(back, [0, 0, 1]);
    }
    /* Parents must be solved before children, and the spine is rooted at
       the shoulders with the neck running backwards through the array. */
    var order = [], seen = new Uint8Array(this.bones.length), pass;
    for (pass = 0; pass < this.bones.length + 2; pass++) {
      var moved = false;
      for (i = 0; i < this.bones.length; i++) {
        if (seen[i]) continue;
        b = this.bones[i];
        if (b.parent < 0 || seen[b.parent]) {
          seen[i] = 1;
          order.push(i);
          moved = true;
        }
      }
      if (!moved) break;
    }
    this.order = order;
    return this;
  };

  Rig.prototype.solve = function (rootQuat, rootOffset) {
    var i, k, b, p;
    for (k = 0; k < this.order.length; k++) {
      i = this.order[k];
      b = this.bones[i];
      if (b.parent < 0) {
        b.Q = qmul(qmul(rootQuat, b.localQuat), b.aq);
        b.P = v3add(b.localPos, rootOffset);
      } else {
        p = this.bones[b.parent];
        b.Q = qmul(qmul(p.Q, b.localQuat), b.aq);
        b.P = v3add(p.P, qrot(p.Q, [
          b.localPos[0] * p.as[0],
          b.localPos[1] * p.as[1],
          b.localPos[2] * p.as[2]
        ]));
      }
    }
  };

  Rig.prototype.reset = function () {
    for (var i = 0; i < this.bones.length; i++) {
      this.bones[i].aq = qid();
      var s = this.bones[i].as;
      s[0] = 1; s[1] = 1; s[2] = 1;
    }
  };

  /* Frames along a spline: X forward (towards the head), Y up, Z left.
     Parallel transport keeps the ring from spinning as the curve twists. */
  function framesAlong(spline, arcs, forwardIsIncreasing) {
    var out = [], i, eps = 0.004;
    var up = [0, 1, 0];
    for (i = 0; i < arcs.length; i++) {
      var s = arcs[i];
      var a = spline.at(Math.max(0, s - eps));
      var b = spline.at(Math.min(spline.length, s + eps));
      var t = v3norm(v3sub(b, a));
      if (!forwardIsIncreasing) t = v3mul(t, -1);
      var y = v3norm(v3sub(up, v3mul(t, v3dot(up, t))));
      if (v3len(y) < 1e-5) y = [0, 1, 0];
      var z = v3cross(t, y);
      out.push({ pos: spline.at(s), q: qnorm(qFromBasis(t, y, z)), x: t, y: y, z: z });
      /* Carry the up vector forward so the frame does not flip. */
      up = y;
    }
    return out;
  }

  /* ================================================================== */
  /* 5. Meshing                                                          */
  /* ================================================================== */

  /*
   * One growable soup of interleaved vertices. Positions go in as model
   * space and are converted to bone space at the end, once normals have
   * been averaged across the whole animal.
   *
   *   pos(3) nrm(3) rest(3) bone(1) uv(2) region(1) scaleSize(1) = 14
   */
  var STRIDE = 14;

  function Soup() {
    this.pos = [];      // model space, rest pose
    this.bone = [];
    this.uv = [];
    this.region = [];
    this.scale = [];
    this.idx = [];
    this.nrm = null;
  }

  Soup.prototype.vert = function (p, bone, u, v, region, scaleSize) {
    this.pos.push(p[0], p[1], p[2]);
    this.bone.push(bone);
    this.uv.push(u, v);
    this.region.push(region);
    this.scale.push(scaleSize);
    return (this.bone.length - 1);
  };

  Soup.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); };

  Soup.prototype.quad = function (a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  };

  /* Area-weighted vertex normals straight off the index buffer. */
  Soup.prototype.computeNormals = function () {
    var n = this.bone.length;
    var nrm = new Float32Array(n * 3), i;
    var p = this.pos, idx = this.idx;
    for (i = 0; i < idx.length; i += 3) {
      var a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      var e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      var e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      var f = v3cross(e1, e2);
      nrm[a] += f[0]; nrm[a + 1] += f[1]; nrm[a + 2] += f[2];
      nrm[b] += f[0]; nrm[b + 1] += f[1]; nrm[b + 2] += f[2];
      nrm[c] += f[0]; nrm[c + 1] += f[1]; nrm[c + 2] += f[2];
    }
    for (i = 0; i < n; i++) {
      var l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
      if (l > 1e-9) { nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l; }
      else { nrm[i * 3 + 1] = 1; }
    }
    this.nrm = nrm;
    return nrm;
  };

  /* Bake into the interleaved buffer the shader reads, with positions and
     normals moved into the frame of the bone that carries them. */
  Soup.prototype.finish = function (rig) {
    var n = this.bone.length;
    var out = new Float32Array(n * STRIDE), i;
    for (i = 0; i < n; i++) {
      var b = rig.bones[this.bone[i]];
      var inv = qconj(b.restQuat);
      var wp = [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
      var wn = [this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]];
      var lp = qrot(inv, v3sub(wp, b.restPos));
      var ln = qrot(inv, wn);
      var o = i * STRIDE;
      out[o] = lp[0]; out[o + 1] = lp[1]; out[o + 2] = lp[2];
      out[o + 3] = ln[0]; out[o + 4] = ln[1]; out[o + 5] = ln[2];
      out[o + 6] = wp[0]; out[o + 7] = wp[1]; out[o + 8] = wp[2];
      out[o + 9] = this.bone[i];
      out[o + 10] = this.uv[i * 2]; out[o + 11] = this.uv[i * 2 + 1];
      out[o + 12] = this.region[i];
      out[o + 13] = this.scale[i];
    }
    return { data: out, index: new Uint32Array(this.idx), count: this.idx.length };
  };

  /* ---- the body ---------------------------------------------------- */

  /*
   * A point on the body's surface at arc fraction u and ring angle th,
   * in the frame f. The mesh sweep walks this, and the eyes are seated
   * against it — guessing at where the skull's surface is and then
   * changing the skull is how eyes end up buried inside heads.
   */
  function ringPoint(f, u, th, withBump) {
    var g = girthAt(u);
    var cy = Math.cos(th), cz = Math.sin(th);
    var e = 2 / g.n;
    var ey = Math.sign(cy) * Math.pow(Math.abs(cy), e) * g.h;
    var ez = Math.sign(cz) * Math.pow(Math.abs(cz), e) * g.w;
    /* Lift the belly line: the underside of a standing lizard is a broad
       flat plate, not the bottom of an oval. */
    if (cy < 0) ey *= lerp(1, 0.88, smoothstep(0.35, 1.0, -cy) * smoothstep(0.20, 0.34, u));
    var off = v3add(v3mul(f.y, ey), v3mul(f.z, ez));
    var radial = v3norm(off);
    var d = withBump ? bumpAt(u, th) : 0;
    return v3add(f.pos, v3add(off, v3mul(radial, d)));
  }

  function buildBody(soup, rig) {
    var spline = new Spline(SPINE_PTS);
    var L = spline.length;

    /* Arc positions for every spine bone, denser where the detail is. */
    var arcs = [], i;
    var aHead = HEAD_LEN, aNeck = aHead + NECK_LEN, aTrunk = aNeck + TRUNK_LEN;
    var scaleToFit = L / (HEAD_LEN + NECK_LEN + TRUNK_LEN + TAIL_LEN);
    aHead *= scaleToFit; aNeck *= scaleToFit; aTrunk *= scaleToFit;

    for (i = 0; i < NB_HEAD; i++) arcs.push(aHead * (i / (NB_HEAD - 1)) * 0.999);
    for (i = 1; i <= NB_NECK; i++) arcs.push(aHead + (aNeck - aHead) * (i / NB_NECK));
    for (i = 1; i <= NB_TRUNK; i++) arcs.push(aNeck + (aTrunk - aNeck) * (i / NB_TRUNK));
    for (i = 1; i <= NB_TAIL; i++) arcs.push(aTrunk + (L - aTrunk) * (i / NB_TAIL));

    var frames = framesAlong(spline, arcs, false);
    var N = frames.length;

    /* The shoulder bone is the root: gaze moves the head without dragging
       the animal across the floor, and the tail hangs off the far end. */
    var kShoulder = NB_HEAD + NB_NECK + 2;
    var base = rig.bones.length;
    for (i = 0; i < N; i++) rig.add(-2, frames[i].pos, frames[i].q);
    for (i = 0; i < N; i++) {
      var b = rig.bones[base + i];
      b.parent = i === kShoulder ? -1 : (i < kShoulder ? base + i + 1 : base + i - 1);
    }

    var spine = {
      base: base,
      count: N,
      arcs: arcs,
      frames: frames,
      length: L,
      root: base + kShoulder,
      uOf: function (i) { return arcs[i] / L; }
    };

    /* Rings. One per bone, so every ring is rigid to a single frame and
       the surface stays smooth however hard the animal bends. */
    var rings = [];
    for (i = 0; i < N; i++) {
      var f = frames[i];
      var u = arcs[i] / L;
      var ss = tableAt(SCALE_SIZE, u)[1];
      var region = u < 0.108 ? R_HEAD : (u > 0.470 ? R_TAIL : R_BODY);
      var ring = [], j;
      for (j = 0; j < RAD_SEG; j++) {
        var th = (j / RAD_SEG) * TAU;
        ring.push(soup.vert(ringPoint(f, u, th, true), base + i, j / RAD_SEG, u, region, ss));
      }
      rings.push(ring);
    }

    /* Skin the rings together, leaving a notch at the front of the snout
       for the tongue to come through. */
    var notchRing = 2, notchLo = Math.floor(RAD_SEG * 0.44), notchHi = Math.floor(RAD_SEG * 0.56);
    for (i = 0; i < N - 1; i++) {
      for (var j2 = 0; j2 < RAD_SEG; j2++) {
        if (i < notchRing && j2 >= notchLo && j2 < notchHi) continue;
        var jn = (j2 + 1) % RAD_SEG;
        soup.quad(rings[i][j2], rings[i + 1][j2], rings[i + 1][jn], rings[i][jn]);
      }
    }

    /* Cap the snout (facing forward, +X) and the tail tip (facing back). */
    capRing(soup, rings[0], frames[0].pos, base, 0, R_HEAD, tableAt(SCALE_SIZE, 0)[1],
      false, notchLo, notchHi);
    capRing(soup, rings[N - 1], frames[N - 1].pos, base + N - 1, 1, R_TAIL,
      tableAt(SCALE_SIZE, 1)[1], true, -1, -1);

    return spine;
  }

  /*
   * Close the end of a swept tube. `flip` picks which way the cap faces:
   * false points it along the frame's +X, true against it. Every ring is
   * wound so that walking the angle anticlockwise about +X is front-facing,
   * which is what the two callers below rely on.
   */
  function capRing(soup, ring, centre, bone, v, region, ss, flip, skipLo, skipHi) {
    var c = soup.vert(centre, bone, 0.5, v, region, ss), j;
    for (j = 0; j < ring.length; j++) {
      if (skipLo >= 0 && j >= skipLo && j < skipHi) continue;
      var jn = (j + 1) % ring.length;
      if (flip) soup.tri(c, ring[jn], ring[j]);
      else soup.tri(c, ring[j], ring[jn]);
    }
  }

  /* ---- limbs, toes and claws --------------------------------------- */

  function buildLimb(soup, rig, spec, side, attachBone, region) {
    var pts = spec.pts.map(function (p) { return [p[0], p[1], p[2] * side]; });
    var spline = new Spline(pts);
    var NBL = 16, SEG = 14, i, j;
    var arcs = [];
    for (i = 0; i < NBL; i++) arcs.push(spline.length * (i / (NBL - 1)) * 0.999);
    var frames = framesAlong(spline, arcs, true);

    var base = rig.bones.length;
    for (i = 0; i < NBL; i++) {
      rig.add(i === 0 ? attachBone : base + i - 1, frames[i].pos, frames[i].q);
    }

    var rings = [];
    for (i = 0; i < NBL; i++) {
      var t = i / (NBL - 1);
      var ri = t * (spec.radii.length - 1);
      var i0 = Math.min(spec.radii.length - 1, Math.floor(ri));
      var i1 = Math.min(spec.radii.length - 1, i0 + 1);
      var r = lerp(spec.radii[i0], spec.radii[i1], ri - i0);
      var f = frames[i];
      var ring = [];
      for (j = 0; j < SEG; j++) {
        var th = (j / SEG) * TAU;
        /* Limbs are ovals, and the foot flattens onto the floor. */
        var flat = smoothstep(0.72, 1.0, t);
        var ry = r * lerp(1.0, 0.62, flat);
        var rz = r * lerp(1.0, 1.30, flat);
        var p = v3add(f.pos, v3add(v3mul(f.y, Math.cos(th) * ry), v3mul(f.z, Math.sin(th) * rz)));
        /* A little muscle where the limb leaves the body. */
        if (t < 0.35) {
          var m = 0.0055 * smoothstep(0.35, 0.02, t) * Math.max(0, Math.cos(th - 0.7 * side));
          p = v3add(p, v3mul(v3norm(v3sub(p, f.pos)), m));
        }
        ring.push(soup.vert(p, base + i, j / SEG, 0.30 + t * 0.25, region, 0.0044));
      }
      rings.push(ring);
    }
    /* Limb rings advance along +X, the body's advance along -X, so the
       two sweeps wind in opposite directions. */
    for (i = 0; i < NBL - 1; i++) {
      for (j = 0; j < SEG; j++) {
        var jn = (j + 1) % SEG;
        soup.quad(rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]);
      }
    }
    capRing(soup, rings[0], frames[0].pos, base, 0.3, region, 0.0044, true, -1, -1);

    /* Toes fan off the foot, each ending in a claw that curves to the floor. */
    var footBone = base + NBL - 1;
    var footFrame = frames[NBL - 1];
    var toeBones = [];
    var origin = [spec.toeBase[0], spec.toeBase[1], spec.toeBase[2] * side];
    for (var t2 = 0; t2 < spec.toeLens.length; t2++) {
      toeBones.push(buildToe(soup, rig, footBone, footFrame, origin,
        spec.toeLens[t2], spec.toeYaw[t2] * side, spec.toeR, side, t2));
    }
    return { base: base, count: NBL, foot: footBone, toes: toeBones, frames: frames };
  }

  function buildToe(soup, rig, footBone, footFrame, origin, len, yaw, r0, side, index) {
    /* Splay in the floor plane, then let the last third hook downwards. */
    var fwd = v3norm([Math.cos(yaw), 0.03, Math.sin(yaw) * side]);

    var NBT = 5, SEG = 9, i, j;
    var pts = [], claw = [];
    for (i = 0; i < NBT; i++) {
      var t = i / (NBT - 1);
      var drop = t > 0.66 ? -0.011 * Math.pow((t - 0.66) / 0.34, 1.8) : 0;
      pts.push(v3add(origin, v3add(v3mul(fwd, len * t), [0, drop, 0])));
      claw.push(t > 0.70);
    }
    var spline = new Spline(pts);
    var arcs = [];
    for (i = 0; i < NBT; i++) arcs.push(spline.length * (i / (NBT - 1)) * 0.999);
    var frames = framesAlong(spline, arcs, true);

    var base = rig.bones.length;
    for (i = 0; i < NBT; i++) {
      rig.add(i === 0 ? footBone : base + i - 1, frames[i].pos, frames[i].q);
    }

    var rings = [];
    for (i = 0; i < NBT; i++) {
      var tt = i / (NBT - 1);
      var r = r0 * (tt < 0.70 ? lerp(1.0, 0.62, tt / 0.70) : lerp(0.62, 0.05, (tt - 0.70) / 0.30));
      var f = frames[i];
      var ring = [];
      for (j = 0; j < SEG; j++) {
        var th = (j / SEG) * TAU;
        var p = v3add(f.pos, v3add(v3mul(f.y, Math.cos(th) * r * 0.92), v3mul(f.z, Math.sin(th) * r)));
        ring.push(soup.vert(p, base + i, j / SEG, 0.4 + tt * 0.1,
          claw[i] ? R_CLAW : R_TOE, claw[i] ? 0.004 : 0.0026));
      }
      rings.push(ring);
    }
    for (i = 0; i < NBT - 1; i++) {
      for (j = 0; j < SEG; j++) {
        var jn = (j + 1) % SEG;
        soup.quad(rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]);
      }
    }
    capRing(soup, rings[NBT - 1], frames[NBT - 1].pos, base + NBT - 1, 0.5, R_CLAW, 0.004,
      false, -1, -1);
    return { base: base, count: NBT, index: index };
  }

  /* ---- eyes -------------------------------------------------------- */

  function buildEye(soup, rig, headBone, headFrame, centre, side) {
    /*
     * The globe's own frame: +X is the gaze direction. A monitor's eyes sit
     * well out on the sides, but not as far out as they look — they are
     * angled forward enough for the two fields to overlap. Thirty degrees
     * off the skull's axis is about right, and it is also the most that can
     * be turned back towards a viewer without the eye leaving its socket.
     */
    var out = v3norm([0.860, 0.130, 0.500 * side]);
    var up = [0, 1, 0];
    var z = v3norm(v3cross(out, up));
    var y = v3cross(z, out);
    var q = qnorm(qFromBasis(out, y, z));

    var globe = rig.add(headBone, centre, q);
    var lidUp = rig.add(globe, centre, q);
    var lidLo = rig.add(globe, centre, q);

    var RINGS = 14, SEGS = 22, i, j;
    var grid = [];
    for (i = 0; i <= RINGS; i++) {
      var row = [];
      var polar = (i / RINGS) * PI;
      for (j = 0; j <= SEGS; j++) {
        var az = (j / SEGS) * TAU;
        /* Polar axis along +X so the shader can read gaze angle straight
           off the bone-local position. */
        var d = [Math.cos(polar), Math.sin(polar) * Math.cos(az), Math.sin(polar) * Math.sin(az)];
        var w = v3add(centre, qrot(q, v3mul(d, EYE_R)));
        row.push(soup.vert(w, globe, j / SEGS, i / RINGS, R_EYE, 0.001));
      }
      grid.push(row);
    }
    for (i = 0; i < RINGS; i++) {
      for (j = 0; j < SEGS; j++) {
        soup.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      }
    }

    buildLid(soup, rig, lidUp, centre, q, 1);
    buildLid(soup, rig, lidLo, centre, q, -1);
    return {
      globe: globe, lidUp: lidUp, lidLo: lidLo, centre: centre, side: side,
      /* Where this eye already points, relative to the skull's axis. The
         aim solve works out from here rather than from straight ahead. */
      restYaw: Math.atan2(out[2], out[0]),
      restPitch: Math.asin(clamp(out[1], -1, 1))
    };
  }

  /* A lid is a spherical cap sitting just proud of the globe. Rolling it
     about the eye's lateral axis opens and closes the aperture. */
  function buildLid(soup, rig, bone, centre, q, sign) {
    var R = EYE_R * 1.045;
    var RINGS = 8, SEGS = 20, i, j;
    var grid = [];
    /* Cap measured from the pole that the lid starts at. */
    for (i = 0; i <= RINGS; i++) {
      var row = [];
      var spread = (i / RINGS) * 1.30;   // radians from the lid's own pole
      for (j = 0; j <= SEGS; j++) {
        var az = (j / SEGS) * TAU;
        /* Lid pole is straight up (or down) in eye space. */
        var axis = [0, sign, 0];
        var perpA = [1, 0, 0], perpB = [0, 0, 1];
        var d = v3add(v3mul(axis, Math.cos(spread)),
          v3add(v3mul(perpA, Math.sin(spread) * Math.cos(az)),
            v3mul(perpB, Math.sin(spread) * Math.sin(az))));
        var w = v3add(centre, qrot(q, v3mul(v3norm(d), R)));
        row.push(soup.vert(w, bone, j / SEGS, i / RINGS, R_LID, 0.0016));
      }
      grid.push(row);
    }
    for (i = 0; i < RINGS; i++) {
      for (j = 0; j < SEGS; j++) {
        /* The upper cap's parameterisation runs the other way round its
           pole, so it needs the reversed winding to face outwards. */
        if (sign > 0) soup.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
        else soup.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      }
    }
  }

  /* ---- tongue and mouth -------------------------------------------- */

  function buildTongue(soup, rig, headBone, headFrame, mouth) {
    var dir = v3norm(headFrame.x);
    var NBT = 10, SEG = 8, i, j;
    var base = rig.bones.length;
    var step = TONGUE_LEN * 0.62 / (NBT - 1);
    var q = headFrame.q;
    for (i = 0; i < NBT; i++) {
      var p = v3add(mouth, v3mul(dir, step * i));
      rig.add(i === 0 ? headBone : base + i - 1, p, q);
    }

    function tube(boneBase, n, r0, r1, region, uOff) {
      var rings = [], k, m;
      for (k = 0; k < n; k++) {
        var t = k / (n - 1);
        var r = lerp(r0, r1, t);
        var b = rig.bones[boneBase + k];
        var ring = [];
        for (m = 0; m < SEG; m++) {
          var th = (m / SEG) * TAU;
          var local = [0, Math.cos(th) * r * 0.65, Math.sin(th) * r];
          var p = v3add(b.restPos, qrot(b.restQuat, local));
          ring.push(soup.vert(p, boneBase + k, m / SEG, uOff + t * 0.1, region, 0.0012));
        }
        rings.push(ring);
      }
      for (k = 0; k < n - 1; k++) {
        for (m = 0; m < SEG; m++) {
          var mn = (m + 1) % SEG;
          soup.quad(rings[k][m], rings[k][mn], rings[k + 1][mn], rings[k + 1][m]);
        }
      }
      return rings;
    }

    tube(base, NBT, 0.0068, 0.0030, R_TONGUE, 0.05);

    /* The fork: two tines off the last bone, spread by their own bones. */
    var forks = [];
    for (var s = -1; s <= 1; s += 2) {
      var fb = rig.bones.length;
      var tip = rig.bones[base + NBT - 1];
      var NF = 5;
      for (i = 0; i < NF; i++) {
        var local = [i * (TONGUE_LEN * 0.38 / (NF - 1)), 0, 0];
        var p = v3add(tip.restPos, qrot(tip.restQuat, local));
        rig.add(i === 0 ? base + NBT - 1 : fb + i - 1, p, tip.restQuat);
      }
      tube(fb, NF, 0.0026, 0.0006, R_TONGUE, 0.06);
      forks.push({ base: fb, count: NF, side: s });
    }

    /* A dark interior behind the notch, so the opening never shows the
       inside of the head. */
    var mb = rig.bones[headBone];
    var c = v3add(mouth, v3mul(dir, -0.012));
    var centre = soup.vert(c, headBone, 0.5, 0.02, R_MOUTH, 0.002);
    var rim = [], n2 = 14;
    for (i = 0; i < n2; i++) {
      var th2 = (i / n2) * TAU;
      var local2 = [-0.004, Math.cos(th2) * 0.0092, Math.sin(th2) * 0.0092];
      rim.push(soup.vert(v3add(c, qrot(mb.restQuat, local2)), headBone,
        i / n2, 0.02, R_MOUTH, 0.002));
    }
    for (i = 0; i < n2; i++) soup.tri(centre, rim[i], rim[(i + 1) % n2]);

    return { base: base, count: NBT, forks: forks, rest: mouth.slice(), dir: dir };
  }

  /* ---- the whole animal -------------------------------------------- */

  function buildLizard() {
    var rig = new Rig();
    var soup = new Soup();
    var spine = buildBody(soup, rig);

    function boneAtU(u) {
      var best = 0, bd = 1e9, i;
      for (i = 0; i < spine.count; i++) {
        var d = Math.abs(spine.uOf(i) - u);
        if (d < bd) { bd = d; best = i; }
      }
      return spine.base + best;
    }

    var shoulderBone = boneAtU(0.232);
    var hipBone = boneAtU(0.458);
    var headBone = boneAtU(0.062);
    var eyeBone = boneAtU(0.0805);

    var limbs = [
      buildLimb(soup, rig, FRONT_LEG, 1, shoulderBone, R_LIMB),
      buildLimb(soup, rig, FRONT_LEG, -1, shoulderBone, R_LIMB),
      buildLimb(soup, rig, HIND_LEG, 1, hipBone, R_LIMB),
      buildLimb(soup, rig, HIND_LEG, -1, hipBone, R_LIMB)
    ];

    /*
     * Eyes ride the skull, set into the sockets the displacement carved.
     * Each is seated by measuring out to the socket floor along its own
     * ring angle and backing off by a third of a radius, so the globe
     * stands a shade proud of the scale rim around it.
     */
    var ef = spine.frames[eyeBone - spine.base];
    var uEye = spine.uOf(eyeBone - spine.base);
    function seatEye(side) {
      var th = side > 0 ? 1.20 : TAU - 1.20;
      var surf = ringPoint(ef, uEye, th, true);
      var out = v3sub(surf, ef.pos);
      var len = v3len(out);
      return v3add(ef.pos, v3mul(v3norm(out), len - EYE_R * 0.35));
    }
    var eyes = [
      buildEye(soup, rig, eyeBone, ef, seatEye(1), 1),
      buildEye(soup, rig, eyeBone, ef, seatEye(-1), -1)
    ];

    var f0 = spine.frames[0];
    var mouth = v3add(f0.pos, v3add(v3mul(f0.x, 0.004), v3mul(f0.y, -0.0045)));
    var tongue = buildTongue(soup, rig, spine.base + 1, f0, mouth);

    rig.bind();
    soup.computeNormals();
    var mesh = soup.finish(rig);

    /*
     * A thinned copy of the rest pose, for the camera to frame against.
     * A bounding box will not do: this animal is long and lies across the
     * diagonal, so the box's corners sit a long way from any actual
     * geometry and the camera backs off to fit empty space. Real points
     * give the real silhouette.
     */
    var hull = [], vn = soup.bone.length;
    var stride = Math.max(1, Math.floor(vn / 260));
    for (var vi = 0; vi < vn; vi += stride) {
      hull.push([soup.pos[vi * 3], soup.pos[vi * 3 + 1], soup.pos[vi * 3 + 2]]);
    }

    return {
      rig: rig,
      mesh: mesh,
      hull: hull,
      spine: spine,
      limbs: limbs,
      eyes: eyes,
      tongue: tongue,
      headBone: headBone,
      eyeBone: eyeBone,
      shoulderBone: shoulderBone,
      hipBone: hipBone,
      /* Gaze is spread across these, weighted towards the skull. */
      tailFirst: spine.base + NB_HEAD + NB_NECK + NB_TRUNK,
      tailLast: spine.base + spine.count - 1,
      trunkFirst: spine.base + NB_HEAD + NB_NECK,
      vertexCount: soup.bone.length
    };
  }

  /* ================================================================== */
  /* 6. Shaders                                                          */
  /* ================================================================== */

  var GLSL_COMMON = [
    'float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }',
    'float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx)*0.1031); q += dot(q, q.yzx+33.33); return fract((q.x+q.y)*q.z); }',
    'vec2 hash22(vec2 p){ vec3 q = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));',
    '  q += dot(q, q.yzx+33.33); return fract((q.xx+q.yz)*q.zy); }',
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x),',
    '             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }',
    'float fbm(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; } return s; }',
    'vec3 qrot(vec4 q, vec3 v){ return v + 2.0*cross(q.xyz, cross(q.xyz, v) + q.w*v); }'
  ].join('\n');

  /* ---- scale texture bake ------------------------------------------ */
  /*
   * Rendered once into a tiling RGBA8 map. Storing the gradient rather
   * than the height means the skin shader gets a bump with a single tap
   * per triplanar axis instead of four.
   *
   *   rg = scale relief gradient   b = per-scale random   a = seam mask
   */
  var BAKE_FS = [
    '#version 300 es',
    'precision highp float;',
    'out vec4 fragColor;',
    'uniform vec2 uSize;',
    GLSL_COMMON,
    'const float N = 20.0;',
    /* Distance to the two nearest jittered cell centres, wrapped so the
       result tiles seamlessly. */
    'vec3 cellF(vec2 uv){',
    '  vec2 g = uv * N;',
    '  vec2 gi = floor(g), gf = fract(g);',
    '  float f1 = 8.0, f2 = 8.0; vec2 best = vec2(0.0);',
    '  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){',
    '    vec2 o = vec2(float(x), float(y));',
    '    vec2 cell = mod(gi + o, vec2(N));',
    '    vec2 j = hash22(cell);',
    '    vec2 r = o + 0.10 + j*0.80 - gf;',
    '    float d = length(r * vec2(1.0, 1.22));',
    '    if(d < f1){ f2 = f1; f1 = d; best = cell; }',
    '    else if(d < f2){ f2 = d; }',
    '  }',
    '  return vec3(f1, f2, hash12(best));',
    '}',
    /* Domed shingle: full height at the middle of a scale, nothing at the seam. */
    'float relief(vec2 uv){',
    '  vec3 c = cellF(uv);',
    '  float dome = clamp((c.y - c.x) * 1.55, 0.0, 1.0);',
    '  float h = pow(dome, 0.55);',
    '  h += (c.z - 0.5) * 0.16;',
    '  h += (vnoise(uv * 260.0) - 0.5) * 0.10;',
    '  return h;',
    '}',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uSize;',
    '  vec2 e = 1.0 / uSize;',
    '  float hx = relief(uv + vec2(e.x, 0.0)) - relief(uv - vec2(e.x, 0.0));',
    '  float hy = relief(uv + vec2(0.0, e.y)) - relief(uv - vec2(0.0, e.y));',
    '  vec2 grad = vec2(hx, hy) / (2.0 * e.x);',
    '  vec3 c = cellF(uv);',
    '  float seam = 1.0 - smoothstep(0.0, 0.075, c.y - c.x);',
    /* GMAX has to bracket the steepest slope a scale edge produces. Encode
       tighter than this and every edge clips to the same value, which is
       how you end up with skin that shades like polished plastic. */
    '  const float GMAX = 46.0;',
    '  fragColor = vec4(clamp(grad / GMAX * 0.5 + 0.5, 0.0, 1.0), c.z, seam);',
    '}'
  ].join('\n');

  var FULLSCREEN_VS = [
    '#version 300 es',
    'void main(){',
    '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* ---- lighting, shared by skin and backdrop ----------------------- */
  /*
   * A three-light studio on a white cyclorama. The key is a large softbox
   * up and to the left; the fill is the wall bouncing back from the right;
   * the ambient term is high and open, because in a white room almost
   * everything you see in shadow is light that came off the walls.
   *
   * Shadowing is analytic: the animal is approximated by a handful of
   * spheres and both the contact shadow and the ambient occlusion are
   * integrated against those. With a source this soft it lands much
   * closer to the real thing than a hard shadow map would.
   */
  var GLSL_LIGHT = [
    'const vec3 L_KEY  = vec3(-0.4200,  0.8100,  0.4080);',
    'const vec3 L_FILL = vec3( 0.8100,  0.2600,  0.5200);',
    'const vec3 L_RIM  = vec3( 0.1800,  0.5200, -0.8300);',
    'const vec3 C_KEY  = vec3(1.000, 0.988, 0.966) * 1.10;',
    'const vec3 C_FILL = vec3(0.940, 0.966, 1.000) * 0.26;',
    'const vec3 C_RIM  = vec3(0.980, 0.985, 1.000) * 0.30;',
    'const vec3 C_SKY  = vec3(0.965, 0.978, 1.000) * 0.34;',
    'const vec3 C_GND  = vec3(1.000, 0.990, 0.965) * 0.26;',
    /* The backdrop is lit separately and harder than the subject, the way
       a real seamless is, so it clips to paper white while the animal keeps
       its tones. Without this the two have to share an exposure and one of
       them always loses. */
    'const float BACK_GAIN = 4.20;',
    '',
    'uniform vec4 uOcc[22];',
    'uniform int uOccN;',
    '',
    'float occlusion(vec3 p, vec3 n, float skipR){',
    '  float o = 0.0;',
    '  for(int i=0;i<22;i++){',
    '    if(i >= uOccN) break;',
    '    vec3 d = uOcc[i].xyz - p;',
    '    float l2 = dot(d,d);',
    '    float r = uOcc[i].w;',
    '    if(l2 < skipR*r*r) continue;',
    '    float l = sqrt(l2);',
    '    float c = clamp(dot(n, d/l), 0.0, 1.0);',
    '    o += c * min(1.0, (r*r)/l2);',
    '  }',
    '  return clamp(1.0 - o * 0.62, 0.0, 1.0);',
    '}',
    '',
    'float softShadow(vec3 p, vec3 L, float soft, float skipR){',
    '  float s = 1.0;',
    '  for(int i=0;i<22;i++){',
    '    if(i >= uOccN) break;',
    '    vec3 oc = uOcc[i].xyz - p;',
    '    float r = uOcc[i].w;',
    '    if(dot(oc,oc) < skipR*r*r) continue;',
    '    float t = dot(oc, L);',
    '    if(t <= 0.0) continue;',
    '    float d = length(oc - L*t);',
    '    float k = (d - r) / max(1e-4, r*0.35 + t*soft);',
    '    s = min(s, smoothstep(-0.55, 1.0, k));',
    '  }',
    '  return s;',
    '}',
    '',
    'float ggx(vec3 n, vec3 v, vec3 l, float rough){',
    '  vec3 h = normalize(v + l);',
    '  float a = max(1e-3, rough*rough);',
    '  float nh = max(dot(n,h), 0.0);',
    '  float d = a*a / (3.14159265 * pow(nh*nh*(a*a-1.0)+1.0, 2.0));',
    '  float nv = max(dot(n,v), 1e-4), nl = max(dot(n,l), 1e-4);',
    '  float k = a*0.5;',
    '  float g = (nl/(nl*(1.0-k)+k)) * (nv/(nv*(1.0-k)+k));',
    '  return d * g / (4.0*nv*nl) * nl;',
    '}',
    '',
    'vec3 hemi(vec3 n){ return mix(C_GND, C_SKY, n.y*0.5+0.5); }',
    '',
    /* The scene target is 8-bit, so radiance has to be brought into range
       here rather than in the post pass — write raw HDR into it and every
       value above one clips to the same flat grey. A soft shoulder keeps
       the low end linear, so the animal keeps its dark tones while the
       backdrop rolls off to paper white. */
    'vec3 tonemap(vec3 x){ return 1.0 - exp(-max(x, vec3(0.0))); }'
  ].join('\n');

  /* ---- skin -------------------------------------------------------- */

  var SKIN_VS = [
    '#version 300 es',
    'precision highp float;',
    'precision highp sampler2D;',
    'in vec3 aPos;',
    'in vec3 aNrm;',
    'in vec3 aRest;',
    'in float aBone;',
    'in vec2 aUV;',
    'in float aRegion;',
    'in float aScale;',
    'uniform sampler2D uBones;',
    'uniform mat4 uVP;',
    'uniform mat4 uModel;',
    'uniform mat3 uModelN;',
    'out vec3 vW;',
    'out vec3 vN;',
    'out vec3 vRest;',
    'out vec3 vLocal;',
    'out vec2 vUV;',
    'out float vScale;',
    'flat out int vRegion;',
    GLSL_COMMON,
    'void main(){',
    '  int b = int(aBone + 0.5);',
    '  vec4 bp = texelFetch(uBones, ivec2(b, 0), 0);',
    '  vec4 bq = texelFetch(uBones, ivec2(b, 1), 0);',
    '  vec4 bs = texelFetch(uBones, ivec2(b, 2), 0);',
    '  vec3 s = max(bs.xyz, vec3(1e-3));',
    '  vec3 p = bp.xyz + qrot(bq, aPos * s);',
    '  vec3 n = qrot(bq, normalize(aNrm / s));',
    '  vec4 w = uModel * vec4(p, 1.0);',
    '  vW = w.xyz;',
    '  vN = normalize(uModelN * n);',
    '  vRest = aRest;',
    '  vLocal = aPos;',
    '  vUV = aUV;',
    '  vScale = aScale;',
    '  vRegion = int(aRegion + 0.5);',
    '  gl_Position = uVP * w;',
    '}'
  ].join('\n');

  var SKIN_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vW;',
    'in vec3 vN;',
    'in vec3 vRest;',
    'in vec3 vLocal;',
    'in vec2 vUV;',
    'in float vScale;',
    'flat in int vRegion;',
    'uniform vec3 uEye;',
    'uniform sampler2D uScales;',
    'uniform float uWet;',
    'out vec4 fragColor;',
    GLSL_COMMON,
    GLSL_LIGHT,
    '',
    /* Triplanar so the scales never stretch or seam, however the body
       bends: the lookup rides the rest pose, which does not deform. */
    'vec4 triScales(vec3 p, vec3 n, float freq, vec2 aniso){',
    '  vec3 w = pow(abs(n), vec3(4.0));',
    '  w /= (w.x + w.y + w.z);',
    '  vec4 x = texture(uScales, p.zy * freq * aniso);',
    '  vec4 y = texture(uScales, p.xz * freq * aniso);',
    '  vec4 z = texture(uScales, p.xy * freq * aniso);',
    '  return x*w.x + y*w.y + z*w.z;',
    '}',
    '',
    'vec3 triGrad(vec3 p, vec3 n, float freq, vec2 aniso){',
    '  vec3 w = pow(abs(n), vec3(4.0));',
    '  w /= (w.x + w.y + w.z);',
    '  vec2 gx = texture(uScales, p.zy * freq * aniso).rg * 2.0 - 1.0;',
    '  vec2 gy = texture(uScales, p.xz * freq * aniso).rg * 2.0 - 1.0;',
    '  vec2 gz = texture(uScales, p.xy * freq * aniso).rg * 2.0 - 1.0;',
    '  return vec3(0.0, gx.y, gx.x) * w.x',
    '       + vec3(gy.x, 0.0, gy.y) * w.y',
    '       + vec3(gz.x, gz.y, 0.0) * w.z;',
    '}',
    '',
    /* Nile-monitor livery: dark olive ground, rows of pale ocelli over the
       back and shoulders, banding down the tail, a cream underside and a
       barred jaw. */
    'vec3 hide(vec2 uv, float belly, int region, float rnd, out float gloss){',
    '  float v = uv.y;',
    '  vec3 dorsal = mix(vec3(0.128,0.132,0.106), vec3(0.086,0.092,0.082),',
    '                    smoothstep(0.20, 0.85, v));',
    '  vec3 flank  = vec3(0.168,0.166,0.134);',
    '  vec3 vent   = vec3(0.700,0.678,0.556);',
    '',
    '  float mott = fbm(vec2(v*70.0, uv.x*22.0));',
    '  dorsal *= 0.80 + 0.42*mott;',
    '',
    '  vec3 c = mix(dorsal, flank, smoothstep(0.30, 0.66, belly));',
    '  c = mix(c, vent, smoothstep(0.72, 0.94, belly));',
    '',
    /* Ocelli: jittered rings of pale scales, densest across the trunk. */
    '  vec2 g = vec2(v*44.0, uv.x*12.0);',
    '  vec2 gi = floor(g), gf = fract(g);',
    '  float ring = 0.0;',
    '  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){',
    '    vec2 o = vec2(float(x), float(y));',
    '    vec2 j = hash22(gi + o);',
    '    float d = length((o + 0.15 + j*0.70 - gf) * vec2(1.0, 0.62));',
    '    ring = max(ring, smoothstep(0.44, 0.31, d) - smoothstep(0.24, 0.13, d));',
    '  }',
    '  float ocelli = ring * smoothstep(0.16, 0.30, v) * smoothstep(0.86, 0.56, v)',
    '               * (1.0 - smoothstep(0.52, 0.80, belly));',
    /* Break the grid up: real ocelli vary in strength across the back and
       fade out where the flank turns under. */
    '  ocelli *= 0.45 + 0.75 * fbm(vec2(v*17.0, uv.x*7.0));',
    '  c = mix(c, vec3(0.455, 0.418, 0.262), clamp(ocelli, 0.0, 1.0) * 0.88);',
    '',
    /* Tail bands. */
    '  float bands = smoothstep(0.50, 0.60, v) * (1.0 - smoothstep(0.93, 1.0, v));',
    '  float bw = 0.5 + 0.5*sin(v*118.0 + 1.2);',
    '  bw = smoothstep(0.42, 0.72, bw);',
    '  c = mix(c, mix(vec3(0.052,0.054,0.048), vec3(0.430,0.406,0.302), bw),',
    '          bands * 0.58 * (1.0 - smoothstep(0.62, 0.90, belly)));',
    '',
    /* Head: fine speckle, and dark bars running down a pale jaw. */
    '  if(region == 1){',
    '    float sp = fbm(vec2(uv.x*38.0, v*420.0));',
    '    c = mix(c, vec3(0.470,0.436,0.300), smoothstep(0.58, 0.86, sp)*0.55);',
    '    float jaw = smoothstep(0.58, 0.86, belly);',
    '    float bars = smoothstep(0.35, 0.65, 0.5+0.5*sin(v*300.0));',
    '    c = mix(c, mix(vec3(0.740,0.716,0.606), vec3(0.150,0.150,0.128), bars*0.55), jaw*0.85);',
    '  }',
    '',
    /* Limbs and toes are darker, with pale flecks. */
    '  if(region == 3 || region == 4){',
    '    c = vec3(0.108,0.112,0.094);',
    '    float sp = fbm(uv*vec2(30.0, 90.0));',
    '    c = mix(c, vec3(0.470,0.442,0.314), smoothstep(0.62, 0.88, sp)*0.60);',
    '  }',
    '',
    '  c *= 0.86 + 0.28*rnd;',
    '  gloss = mix(0.52, 0.30, belly);',
    '  return c;',
    '}',
    '',
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  vec3 v = normalize(uEye - vW);',
    '  float belly = 1.0 - abs(vUV.x - 0.5) * 2.0;',
    '  belly = pow(clamp(belly, 0.0, 1.0), 0.85);',
    '',
    '  vec3 albedo; float rough; float ao = 1.0; float spec = 1.0;',
    '',
    '  if(vRegion == 6){',
    /* ---- eye ---- */
    '    vec3 d = normalize(vLocal);',
    '    float ang = acos(clamp(d.x, -1.0, 1.0));',
    '    float iris = smoothstep(0.80, 0.70, ang);',
    '    float pupil = smoothstep(0.245, 0.190, ang);',
    '    vec3 sclera = vec3(0.055, 0.052, 0.046);',
    /* Radial striae in the iris, and a darker limbal ring at its edge —
       between them they are most of what makes an eye look wet and alive
       rather than like a bead of glass. */
    '    float fib = 0.5 + 0.5*sin(atan(d.z, d.y) * 68.0 + ang*34.0);',
    '    fib = mix(fib, hash12(vec2(atan(d.z, d.y)*9.0, 3.0)), 0.30);',
    '    vec3 irisC = mix(vec3(0.300, 0.222, 0.062), vec3(0.690, 0.566, 0.196), fib);',
    '    irisC *= 0.55 + 0.72 * smoothstep(0.18, 0.52, ang);',
    '    irisC *= 1.0 - smoothstep(0.60, 0.76, ang) * 0.72;',
    '    albedo = mix(sclera, irisC, iris);',
    '    albedo = mix(albedo, vec3(0.006), pupil);',
    '    rough = 0.050;',
    '    spec = 2.6;',
    '  } else if(vRegion == 9){',
    /* ---- inside of the mouth ---- */
    '    albedo = vec3(0.028, 0.020, 0.020);',
    '    rough = 0.62;',
    '  } else if(vRegion == 8){',
    /* ---- tongue: dark blue-black, wet ---- */
    '    albedo = mix(vec3(0.070,0.062,0.098), vec3(0.026,0.024,0.044), vUV.y*4.0);',
    '    rough = 0.16;',
    '    spec = 1.7;',
    '  } else if(vRegion == 5){',
    /* ---- claw: horn, smooth and dark ---- */
    '    albedo = vec3(0.062, 0.056, 0.048);',
    '    rough = 0.24;',
    '    spec = 1.4;',
    '  } else {',
    /* ---- scaled hide ---- */
    '    float freq = 1.0 / max(0.0008, vScale * 20.0);',
    '    vec2 aniso = vRegion == 7 ? vec2(1.6) : mix(vec2(1.0), vec2(0.72, 1.0), smoothstep(0.7, 1.0, belly));',
    '    vec4 s = triScales(vRest, n, freq, aniso);',
    '    vec3 grad = triGrad(vRest, n, freq, aniso);',
    '    float bump = vRegion == 7 ? 0.16 : 0.30;',
    '    n = normalize(n - bump * (grad - n*dot(n, grad)));',
    '    float gloss;',
    '    albedo = hide(vUV, belly, vRegion, s.b, gloss);',
    '    if(vRegion == 7){',
    /* Eyelid: same hide, tightened, with a dark margin at the rim. */
    '      albedo = mix(vec3(0.088,0.090,0.076), vec3(0.300,0.286,0.222), s.b*0.7);',
    '      albedo *= mix(0.35, 1.0, smoothstep(0.62, 1.0, vUV.y));',
    '      gloss = 0.46;',
    '    }',
    '    albedo *= mix(0.62, 1.0, smoothstep(0.0, 0.55, s.a) * 0.6 + 0.4);',
    '    rough = clamp(mix(0.70, 0.34, gloss) + (s.b - 0.5)*0.18 - uWet*0.10, 0.10, 0.95);',
    '    ao = mix(1.0, 0.72, s.a);',
    '  }',
    '',
    '  float shade = occlusion(vW, n, 2.4) * ao;',
    '  float sh = softShadow(vW, L_KEY, 0.34, 4.0);',
    '',
    '  float wrap = 0.34;',
    '  float nlK = max(0.0, (dot(n, L_KEY) + wrap) / (1.0 + wrap));',
    '  float nlF = max(0.0, (dot(n, L_FILL) + wrap) / (1.0 + wrap));',
    '  float nlR = max(0.0, dot(n, L_RIM));',
    '',
    '  vec3 diff = C_KEY * nlK * mix(0.35, 1.0, sh)',
    '            + C_FILL * nlF',
    '            + C_RIM * nlR * 0.30;',
    '  diff += hemi(n) * 0.62;',
    '  diff *= shade;',
    '',
    '  float f0 = 0.045;',
    '  float fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);',
    '  vec3 sp = (C_KEY * ggx(n, v, L_KEY, rough) * mix(0.25, 1.0, sh)',
    '           + C_FILL * ggx(n, v, L_FILL, rough) * 1.4',
    '           + C_RIM * ggx(n, v, L_RIM, rough) * 1.1) * fres * spec * 3.0;',
    /* The white room itself reflects: a broad sheen on every glancing edge.
       Kept low — push it and the smooth parts of the animal, the skull and
       the neck, burn out into the backdrop. */
    '  sp += vec3(0.92, 0.94, 0.97) * fres * 0.26 * shade;',
    '',
    '  vec3 col = albedo * diff + sp;',
    '  fragColor = vec4(tonemap(col), 1.0);',
    '}'
  ].join('\n');

  /* ---- backdrop ---------------------------------------------------- */

  var BACK_VS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 aPos;',
    'in vec3 aNrm;',
    'uniform mat4 uVP;',
    'out vec3 vW;',
    'out vec3 vN;',
    'void main(){',
    '  vW = aPos;',
    '  vN = aNrm;',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  var BACK_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vW;',
    'in vec3 vN;',
    'uniform vec3 uEye;',
    'out vec4 fragColor;',
    GLSL_COMMON,
    GLSL_LIGHT,
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  float shade = occlusion(vW, n, 0.0);',
    '  float sh = softShadow(vW, L_KEY, 0.42, 0.0);',
    '  float fill = softShadow(vW, L_FILL, 0.85, 0.0);',
    '',
    '  vec3 base = vec3(0.965, 0.962, 0.955);',
    '  float nlK = max(0.0, dot(n, L_KEY));',
    '  float nlF = max(0.0, dot(n, L_FILL));',
    '  vec3 diff = C_KEY * nlK * mix(0.08, 1.0, sh)',
    '            + C_FILL * nlF * mix(0.30, 1.0, fill)',
    '            + hemi(n) * 0.70;',
    '  diff *= mix(1.0, shade, 0.85);',
    '  vec3 col = base * diff * BACK_GAIN;',
    /* Seamless paper falls off gently towards the top and the wings —
       gently enough that it never reads as a grey box. */
    '  col *= 1.0 - smoothstep(0.60, 2.60, vW.y) * 0.075;',
    '  col *= 1.0 - smoothstep(1.60, 3.60, abs(vW.x)) * 0.10;',
    '  fragColor = vec4(tonemap(col), 1.0);',
    '}'
  ].join('\n');

  /* ---- post -------------------------------------------------------- */

  var POST_FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uScene;',
    'uniform vec2 uTexel;',
    'uniform float uTime;',
    'uniform float uGrain;',
    'out vec4 fragColor;',
    GLSL_COMMON,
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy * uTexel;',
    /* Box-downsample the supersampled scene: cheap, and it is the edges
       of the silhouette that give a render away. */
    '  vec2 o = uTexel * 0.5;',
    '  vec3 c = texture(uScene, uv + vec2(-o.x, -o.y)).rgb',
    '         + texture(uScene, uv + vec2( o.x, -o.y)).rgb',
    '         + texture(uScene, uv + vec2(-o.x,  o.y)).rgb',
    '         + texture(uScene, uv + vec2( o.x,  o.y)).rgb;',
    '  c *= 0.25;',
    /* Barely-there vignette and film grain. Both are what stops a white */
    /* frame reading as a blank div. */
    '  vec2 q = uv - 0.5;',
    '  c *= 1.0 - dot(q, q) * 0.040;',
    '  float g = hash12(gl_FragCoord.xy + fract(uTime) * 431.7) - 0.5;',
    '  c += g * uGrain;',
    /* Ordered dither kills the banding a white gradient would show. */
    '  float dth = (hash12(gl_FragCoord.xy * 0.37) - 0.5) / 255.0;',
    '  fragColor = vec4(pow(max(c + dth, 0.0), vec3(1.0/2.2)), 1.0);',
    '}'
  ].join('\n');

  /* ================================================================== */
  /* 7. Behaviour                                                        */
  /* ================================================================== */

  /*
   * A stationary monitor lizard is never still. It breathes, it pumps its
   * throat, its tail drifts, it shifts weight between its feet, it blinks
   * out of step with itself, and every few seconds it tastes the air. None
   * of that is triggered by the visitor. The only thing they control is
   * where it is looking.
   */
  function Behaviour(model) {
    this.m = model;
    this.t = 0;

    /* gaze, in radians, spring-damped towards the target */
    this.yaw = 0; this.pitch = 0;
    this.yawV = 0; this.pitchV = 0;
    this.tgtYaw = 0; this.tgtPitch = 0;
    this.eyeYaw = 0; this.eyePitch = 0;
    this.roll = 0; this.rollV = 0;

    /* discrete behaviours */
    this.blinkAt = 2.2; this.blink = 0; this.blinkPhase = 0; this.blinkQueue = 0;
    this.flickAt = 4.0; this.flick = 0; this.flickQueue = 0;
    this.gularAt = 7.0; this.gular = 0;
    this.shiftAt = 9.0; this.shift = 0; this.shiftLeg = 0;
    this.stretchAt = 34.0; this.stretch = 0;
    this.breathRate = 0.30;
    this.alert = 0;              // rises when the gaze target jumps
    this.damp = 1;               // scaled down under prefers-reduced-motion
  }

  Behaviour.prototype.setTarget = function (yaw, pitch) {
    var moved = Math.abs(yaw - this.tgtYaw) + Math.abs(pitch - this.tgtPitch);
    if (moved > 0.22) this.alert = Math.min(1, this.alert + moved * 0.9);
    this.tgtYaw = yaw;
    this.tgtPitch = pitch;
  };

  Behaviour.prototype.step = function (dt) {
    var d = this.damp;
    this.t += dt;
    var t = this.t;

    /* --- gaze: critically damped, with a little lag in the neck ----- */
    var k = 26.0, c = 2 * Math.sqrt(k);
    this.yawV += (-(this.yaw - this.tgtYaw) * k - this.yawV * c) * dt;
    this.pitchV += (-(this.pitch - this.tgtPitch) * k - this.pitchV * c) * dt;
    this.yaw += this.yawV * dt;
    this.pitch += this.pitchV * dt;

    /* Eyes get there first — they always do. */
    var ek = 90.0;
    this.eyeYaw += (this.tgtYaw - this.yaw - this.eyeYaw) * Math.min(1, ek * dt * 0.12);
    this.eyePitch += (this.tgtPitch - this.pitch - this.eyePitch) * Math.min(1, ek * dt * 0.12);

    /* A head that turns hard rolls slightly into the turn. */
    var rollTgt = -this.yaw * 0.16 + fbm1(t * 0.21, 7) * 0.055 * d;
    this.rollV += (-(this.roll - rollTgt) * 18 - this.rollV * 8.5) * dt;
    this.roll += this.rollV * dt;

    this.alert = Math.max(0, this.alert - dt * 0.55);

    /* --- blinking --------------------------------------------------- */
    this.blinkAt -= dt;
    if (this.blinkAt <= 0 && this.blink <= 0) {
      this.blink = 0.001;
      this.blinkPhase = 0;
      /* Alert animals blink less; a settled one doubles up. */
      this.blinkAt = lerp(2.6, 7.4, Math.random()) * lerp(1.0, 1.6, this.alert);
      if (Math.random() < 0.28) this.blinkQueue = 1;
    }
    if (this.blink > 0) {
      this.blinkPhase += dt / 0.17;
      this.blink = this.blinkPhase < 1
        ? Math.sin(Math.min(1, this.blinkPhase) * PI)
        : 0;
      if (this.blinkPhase >= 1) {
        this.blink = 0;
        if (this.blinkQueue > 0) { this.blinkQueue--; this.blinkAt = 0.22; }
      }
    }

    /* --- tongue flicks ---------------------------------------------- */
    this.flickAt -= dt;
    if (this.flickAt <= 0 && this.flick <= 0) {
      this.flick = 0.001;
      this.flickQueue = 1 + (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.22 ? 1 : 0);
      this.flickAt = lerp(5.0, 13.0, Math.random());
    }
    if (this.flick > 0) {
      this.flick += dt / 0.34;
      if (this.flick >= 1) {
        this.flick = 0;
        if (this.flickQueue > 1) { this.flickQueue--; this.flick = 0.001; }
      }
    }

    /* --- throat pumping --------------------------------------------- */
    this.gularAt -= dt;
    if (this.gularAt <= 0) {
      this.gular = 1;
      this.gularAt = lerp(6.0, 17.0, Math.random());
    }
    this.gular = Math.max(0, this.gular - dt * 0.30);

    /* --- weight shifts and the odd re-planted foot ------------------- */
    this.shiftAt -= dt;
    if (this.shiftAt <= 0 && this.shift <= 0) {
      this.shift = 0.001;
      this.shiftLeg = Math.floor(Math.random() * 4);
      this.shiftAt = lerp(11.0, 26.0, Math.random());
    }
    if (this.shift > 0) {
      this.shift += dt / 1.15;
      if (this.shift >= 1) this.shift = 0;
    }

    /* --- the rare full-body stretch ---------------------------------- */
    this.stretchAt -= dt;
    if (this.stretchAt <= 0 && this.stretch <= 0) {
      this.stretch = 0.001;
      this.stretchAt = lerp(40.0, 95.0, Math.random());
    }
    if (this.stretch > 0) {
      this.stretch += dt / 2.6;
      if (this.stretch >= 1) this.stretch = 0;
    }
  };

  /* Write the current behaviour into the rig's animation slots. */
  Behaviour.prototype.apply = function () {
    var m = this.m, rig = m.rig, t = this.t, d = this.damp, i;
    rig.reset();

    var breathPhase = t * this.breathRate * TAU;
    var breath = Math.sin(breathPhase);
    var stretch = this.stretch > 0 ? Math.sin(Math.min(1, this.stretch) * PI) : 0;

    /* --- trunk: breathing, and the slow roll of shifting weight ----- */
    for (i = m.trunkFirst; i <= m.hipBone + 4 && i < m.spine.base + m.spine.count; i++) {
      var b = rig.bones[i];
      var u = m.spine.uOf(i - m.spine.base);
      var chest = Math.exp(-Math.pow((u - 0.290) / 0.130, 2));
      var s = 1 + breath * 0.020 * chest * d + stretch * 0.012 * chest;
      b.as[1] = s;
      b.as[2] = s * (1 + breath * 0.006 * chest * d);
    }

    /* --- neck and throat -------------------------------------------- */
    for (i = m.trunkFirst - 1; i >= m.spine.base + NB_HEAD - 1; i--) {
      var nb = rig.bones[i];
      var nu = m.spine.uOf(i - m.spine.base);
      var throat = Math.exp(-Math.pow((nu - 0.150) / 0.045, 2));
      var pump = Math.sin(t * 7.4) * this.gular * 0.055 + breath * 0.012;
      var sc = 1 + pump * throat * d;
      nb.as[1] = sc;
      nb.as[2] = sc;
    }

    /* --- gaze -------------------------------------------------------- */
    /*
     * Only the neck bends: everything forward of the skull/neck junction
     * is bone, and a skull that flexes is the fastest way to look fake.
     *
     * The turn is spread almost evenly across the cervicals rather than
     * concentrated at one joint. That is not just for looks. Each ring of
     * the mesh is rigid to a single bone, so a joint that rotates by more
     * than roughly (ring spacing / girth) radians folds its ring through
     * its neighbour and the neck comes apart into a stack of shells. A
     * raised-cosine weighting keeps every joint far inside that limit and
     * puts the deepest bend in the middle of the neck, which is where a
     * real one bends anyway.
     */
    var n1 = m.spine.base + NB_HEAD - 1;            // skull/neck junction
    var n0 = m.spine.base + NB_HEAD + NB_NECK - 1;  // last cervical before
                                                    // the shoulder girdle
    var span = n0 - n1;
    var wsum = 0, j;
    for (j = 0; j <= span; j++) wsum += 0.35 + 0.65 * Math.sin(PI * (j + 0.5) / (span + 1));
    for (i = n1; i <= n0; i++) {
      var nb2 = rig.bones[i];
      var w = (0.35 + 0.65 * Math.sin(PI * (i - n1 + 0.5) / (span + 1))) / wsum;
      var wob = fbm1(t * 0.33 + i * 0.11, 3) * 0.006 * d;
      var q = qAxis(nb2.axY, -this.yaw * w + wob * 0.4);
      q = qmul(q, qAxis(nb2.axZ, this.pitch * w + wob));
      q = qmul(q, qAxis(nb2.axX, this.roll * w * 1.4));
      nb2.aq = q;
    }

    /* Neck lifts a little when the animal is paying attention. */
    var lift = this.alert * 0.09 + stretch * 0.16;
    for (i = n1; i <= n0; i++) {
      rig.bones[i].aq = qmul(rig.bones[i].aq, qAxis(rig.bones[i].axZ, lift * 0.05));
    }

    /* --- tail: a slow travelling wave, plus the occasional tip flick -- */
    var tailN = m.tailLast - m.tailFirst;
    for (i = m.tailFirst; i <= m.tailLast; i++) {
      var tf = (i - m.tailFirst) / Math.max(1, tailN);
      var amp = (0.006 + 0.030 * tf * tf) * d;
      var wave = Math.sin(t * 0.62 - tf * 3.1) * amp;
      var drift = fbm1(t * 0.17 + tf * 2.0, 5) * amp * 0.7;
      var droop = Math.sin(t * 0.41 - tf * 2.2) * 0.004 * d;
      var tb2 = rig.bones[i];
      var tq = qAxis(tb2.axY, wave + drift);
      tq = qmul(tq, qAxis(tb2.axZ, droop));
      tb2.aq = qmul(tb2.aq, tq);
    }

    /* --- limbs: micro-adjustments, and a real re-plant now and then --- */
    for (var li = 0; li < m.limbs.length; li++) {
      var limb = m.limbs[li];
      var active = (this.shift > 0 && this.shiftLeg === li)
        ? Math.sin(Math.min(1, this.shift) * PI) : 0;
      for (i = 0; i < limb.count; i++) {
        var lb = rig.bones[limb.base + i];
        var lt = i / (limb.count - 1);
        var micro = fbm1(t * 0.24 + li * 3.7 + lt * 1.4, 9 + li) * 0.012 * d;
        /* Lift from the shoulder, fold at the elbow, set it back down. */
        var raise = active * 0.30 * Math.exp(-Math.pow((lt - 0.06) / 0.16, 2));
        var fold = active * 0.42 * Math.exp(-Math.pow((lt - 0.42) / 0.20, 2));
        var q2 = qAxis([0, 0, 1], micro + raise - fold * 0.4);
        q2 = qmul(q2, qAxis([1, 0, 0], micro * 0.6 + fold * 0.5));
        lb.aq = q2;
      }
      for (var ti = 0; ti < limb.toes.length; ti++) {
        var toe = limb.toes[ti];
        for (i = 0; i < toe.count; i++) {
          var grip = Math.sin(t * 0.19 + ti * 1.7 + li * 2.3) * 0.020 * d;
          rig.bones[toe.base + i].aq = qAxis([0, 0, 1], grip - active * 0.16);
        }
      }
    }

    /* --- eyes and lids ---------------------------------------------- */
    for (var ei = 0; ei < m.eyes.length; ei++) {
      var eye = m.eyes[ei];
      var gb = rig.bones[eye.globe];
      /*
       * Each eye aims itself. Its rest direction already carries the
       * outward set of the socket, so what is left to cover is whatever
       * the neck did not: the gap between where the target is and where
       * the head actually ended up, less the eye's own outward angle.
       * Clamped to what an eye can physically do — past that it is the
       * neck's job, and the animal will get there in a moment anyway.
       */
      var ey = clamp((this.tgtYaw - this.yaw) - eye.restYaw, -0.50, 0.50);
      var ep = clamp((this.tgtPitch - this.pitch) - eye.restPitch, -0.32, 0.32);
      /* Micro-saccades: an eye is never quite still either. */
      ey += fbm1(t * 2.3 + ei * 5.1, 13) * 0.018;
      ep += fbm1(t * 2.1 + ei * 7.3, 17) * 0.014;
      gb.aq = qmul(qAxis(gb.axY, -ey), qAxis(gb.axZ, ep));

      /*
       * Lids roll back off the globe to open. Positive rolls the upper
       * lid's pole away from the gaze axis, negative brings it across —
       * the signs matter, because inverted lids sit closed over an eye
       * that then blinks itself open. They overlap slightly when shut so
       * the blink actually closes rather than leaving a slit.
       */
      var cl = this.blink;
      rig.bones[eye.lidUp].aq = qAxis([0, 0, 1], 0.62 - cl * 0.94 + ep * 0.30);
      rig.bones[eye.lidLo].aq = qAxis([0, 0, 1], -0.46 + cl * 0.68 + ep * 0.12);
    }

    /* --- tongue ------------------------------------------------------ */
    var m2 = m.tongue;
    /* Out fast, back faster, forks spreading at the top of the arc. */
    var fx = this.flick > 0 ? Math.min(1, this.flick) : 0;
    var ext = fx > 0 ? Math.pow(Math.sin(fx * PI), 0.55) : 0;
    var lenScale = lerp(0.02, 1.0, ext);
    var girth = lerp(0.55, 1.0, ext);
    for (i = 0; i < m2.count; i++) {
      var tb = rig.bones[m2.base + i];
      var tt2 = i / (m2.count - 1);
      /* Slight upward arc on the way out, and a sideways sweep at the tip
         — a monitor tastes the air, it does not point at it. */
      var rise = ext * 0.30 * smoothstep(0.15, 1.0, tt2);
      tb.aq = qAxis([0, 0, 1], rise);
      if (i === 0) {
        tb.aq = qmul(tb.aq, qAxis([0, 1, 0], Math.sin(t * 9.0) * 0.16 * ext));
      }
      tb.as[0] = lenScale; tb.as[1] = girth; tb.as[2] = girth;
    }
    for (var fi = 0; fi < m2.forks.length; fi++) {
      var fk = m2.forks[fi];
      for (i = 0; i < fk.count; i++) {
        var fb2 = rig.bones[fk.base + i];
        fb2.aq = qAxis([0, 1, 0], ext * 0.46 * (i / (fk.count - 1)) * fk.side);
        fb2.as[0] = lenScale; fb2.as[1] = girth; fb2.as[2] = girth;
      }
    }
    /* The head dips fractionally into each flick — from the neck, never
       from inside the skull. */
    if (ext > 0) {
      var hb = rig.bones[n1];
      hb.aq = qmul(hb.aq, qAxis(hb.axZ, -ext * 0.05));
    }

    /* --- root: breath lift, weight roll, the slowest drift ----------- */
    var sway = fbm1(t * 0.13, 1) * 0.020 * d;
    var rootQ = qmul(qAxis([1, 0, 0], sway * 0.9 + (this.shift > 0 ?
      Math.sin(Math.min(1, this.shift) * PI) * (this.shiftLeg % 2 ? 0.028 : -0.028) : 0)),
      qAxis([0, 1, 0], fbm1(t * 0.09, 2) * 0.020 * d));
    var rootP = [
      fbm1(t * 0.11, 4) * 0.004 * d,
      breath * 0.0032 * d + stretch * 0.010,
      fbm1(t * 0.10, 6) * 0.005 * d
    ];
    return { q: rootQ, p: rootP };
  };

  /* ================================================================== */
  /* 8. Renderer                                                         */
  /* ================================================================== */

  var MAX_DPR = 2;
  var COARSE_DPR = 1.5;
  var SUPER = 1.3;              // supersample factor for the scene pass
  var PERF_WINDOW = 50;
  var PERF_BUDGET = 24;
  var MAX_OCC = 22;

  function Studio(host, canvas) {
    this.host = host;
    this.canvas = canvas;
    this.gl = null;
    this.model = null;
    this.beh = null;
    this.raf = 0;
    this.last = 0;
    this.acc = 0;
    this.frames = 0;
    this.frameSum = 0;
    this.scale = 1;
    this.running = false;
    this.ready = false;
    this.W = 0; this.H = 0;
    this.occ = new Float32Array(MAX_OCC * 4);
    this.occN = 0;
    this.mVP = new Float32Array(16);
    this.mProj = new Float32Array(16);
    this.mView = new Float32Array(16);
    this.mModel = new Float32Array(16);
    this.mNormal = new Float32Array(9);
    this.eye = [0, 0.42, 2.25];
    this.target = [0, 0.18, 0];
    this.modelYaw = YAW_WIDE;
    this.fitAspect = -1;
    this.hull = null;
    /* Where the visitor is, in normalised screen space. */
    this.gaze = [0, 0];
  }

  Studio.prototype.init = function () {
    var gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    if (!gl) return false;
    this.gl = gl;

    this.model = buildLizard();
    this.hull = this.model.hull;
    this.beh = new Behaviour(this.model);

    this.progSkin = program(gl, SKIN_VS, SKIN_FS, 'skin');
    this.progBack = program(gl, BACK_VS, BACK_FS, 'backdrop');
    this.progPost = program(gl, FULLSCREEN_VS, POST_FS, 'post');
    this.progBake = program(gl, FULLSCREEN_VS, BAKE_FS, 'bake');

    this._buildSkinVAO();
    this._buildBackdrop();
    this._buildBoneTexture();
    this._bakeScales();

    this.emptyVAO = gl.createVertexArray();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(1, 1, 1, 1);
    return true;
  };

  Studio.prototype._buildSkinVAO = function () {
    var gl = this.gl, mesh = this.model.mesh, p = this.progSkin;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    var S = STRIDE * 4;
    function attr(name, size, off) {
      var loc = gl.getAttribLocation(p, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off * 4);
    }
    attr('aPos', 3, 0);
    attr('aNrm', 3, 3);
    attr('aRest', 3, 6);
    attr('aBone', 1, 9);
    attr('aUV', 2, 10);
    attr('aRegion', 1, 12);
    attr('aScale', 1, 13);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.skinCount = mesh.count;
  };

  /* A studio sweep: floor running back, curving up into the wall, with no
     seam anywhere the camera can see. */
  Studio.prototype._buildBackdrop = function () {
    var gl = this.gl, p = this.progBack;
    var NZ = 64, NX = 2;
    var verts = [], idx = [], i, j;
    var zFront = 2.6, zBack = -2.4, curveStart = -0.85, radius = 1.5;
    var xHalf = 4.2;

    function pointAt(t) {
      /* t: 0 at the front of the floor, 1 at the top of the wall. */
      var z = lerp(zFront, curveStart, Math.min(1, t / 0.55));
      if (t <= 0.55) return { p: [0, 0, z], n: [0, 1, 0] };
      var a = ((t - 0.55) / 0.45) * (PI * 0.5);
      return {
        p: [0, radius * (1 - Math.cos(a)), curveStart - radius * Math.sin(a)],
        n: [0, Math.cos(a), Math.sin(a)]
      };
    }

    for (i = 0; i <= NZ; i++) {
      var pt = pointAt(i / NZ);
      for (j = 0; j <= NX; j++) {
        var x = lerp(-xHalf, xHalf, j / NX);
        verts.push(x, pt.p[1], pt.p[2], pt.n[0], pt.n[1], pt.n[2]);
      }
    }
    for (i = 0; i < NZ; i++) {
      for (j = 0; j < NX; j++) {
        var a0 = i * (NX + 1) + j, b0 = a0 + 1;
        var c0 = (i + 1) * (NX + 1) + j, d0 = c0 + 1;
        idx.push(a0, d0, c0, a0, b0, d0);
      }
    }
    /* Guard the far edge: extend the wall well past the top of frame. */
    var top = pointAt(1);
    var baseIdx = (NZ + 1) * (NX + 1);
    for (j = 0; j <= NX; j++) {
      verts.push(lerp(-xHalf, xHalf, j / NX), top.p[1] + 4.0, top.p[2], 0, 0, 1);
    }
    for (j = 0; j < NX; j++) {
      var a1 = NZ * (NX + 1) + j, b1 = a1 + 1;
      var c1 = baseIdx + j, d1 = c1 + 1;
      idx.push(a1, d1, c1, a1, b1, d1);
    }

    this.backVAO = gl.createVertexArray();
    gl.bindVertexArray(this.backVAO);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    var lp = gl.getAttribLocation(p, 'aPos');
    var ln = gl.getAttribLocation(p, 'aNrm');
    gl.enableVertexAttribArray(lp);
    gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(ln);
    gl.vertexAttribPointer(ln, 3, gl.FLOAT, false, 24, 12);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.backCount = idx.length;
  };

  /* Bones live in a float texture: three texels each, position, rotation
     and scale, refilled once a frame. */
  Studio.prototype._buildBoneTexture = function () {
    var gl = this.gl;
    var n = this.model.rig.bones.length;
    this.boneW = 1;
    while (this.boneW < n) this.boneW *= 2;
    this.boneData = new Float32Array(this.boneW * 3 * 4);
    this.boneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.boneTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.boneW, 3, 0, gl.RGBA, gl.FLOAT, null);
  };

  Studio.prototype._bakeScales = function () {
    var gl = this.gl, size = 1024;
    this.scaleTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.scaleTex, 0);
    gl.viewport(0, 0, size, size);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.progBake);
    gl.uniform2f(this.progBake.u.uSize, size, size);
    var tmp = gl.createVertexArray();
    gl.bindVertexArray(tmp);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.deleteVertexArray(tmp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.enable(gl.DEPTH_TEST);

    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    var aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      var max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
  };

  Studio.prototype.resize = function () {
    var gl = this.gl;
    var rect = this.host.getBoundingClientRect();
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var dpr = Math.min(window.devicePixelRatio || 1, coarse ? COARSE_DPR : MAX_DPR);
    var w = Math.max(1, Math.round(rect.width * dpr * this.scale));
    var h = Math.max(1, Math.round(rect.height * dpr * this.scale));
    if (w === this.W && h === this.H) return;
    this.W = w; this.H = h;
    this.canvas.width = w;
    this.canvas.height = h;

    /* Scene target, supersampled, resolved down in the post pass. */
    var sw = Math.max(1, Math.round(w * SUPER));
    var sh = Math.max(1, Math.round(h * SUPER));
    this.SW = sw; this.SH = sh;

    if (!this.sceneTex) {
      this.sceneTex = gl.createTexture();
      this.depthRB = gl.createRenderbuffer();
      this.sceneFBO = gl.createFramebuffer();
    }
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, sw, sh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  /* Frame the animal: pull back and drop the camera on tall screens so a
     phone in portrait still gets the whole animal, not a crop of a flank. */
  /*
   * Frame the animal rather than guess at it.
   *
   * The subject's bounds are known, so the camera can be solved for: pick
   * the presentation angle from the aspect ratio, then iterate distance and
   * aim until the projected bounds fill the frame by the right fraction.
   * Four passes converge to well under a pixel, and it costs nothing —
   * this only re-runs when the window changes shape.
   */
  Studio.prototype.camera = function () {
    var aspect = this.W / Math.max(1, this.H);
    if (this.fitAspect === aspect) return;
    this.fitAspect = aspect;

    var tall = sat((1.0 - aspect) / 0.5);
    /* A short, wide frame — a phone on its side, a squat browser window —
       has no vertical room to give the wordmark, so the animal takes less
       of the height and sits lower. */
    var squat = sat((aspect - 1.8) / 0.9);
    this.modelYaw = lerp(YAW_WIDE, YAW_TALL, tall);
    var fillX = lerp(FILL_X_WIDE, FILL_X_TALL, tall);
    var fillY = lerp(FILL_Y_WIDE, FILL_Y_TALL, tall) * lerp(1.0, 0.80, squat);

    mFromRT(this.mModel, qAxis([0, 1, 0], this.modelYaw), [0, 0, 0]);
    mNormal3(this.mNormal, this.mModel);

    var corners = [], i;
    for (i = 0; i < this.hull.length; i++) corners.push(this.toWorld(this.hull[i]));

    var dir = v3norm(CAM_DIR);
    var target = [0, 0.18, 0];
    var dist = 2.2;
    var pass, k;

    for (pass = 0; pass < 4; pass++) {
      this.eye = v3add(target, v3mul(dir, dist));
      mPerspective(this.mProj, FOV, aspect, 0.05, 40);
      mLookAt(this.mView, this.eye, target, [0, 1, 0]);
      mMul(this.mVP, this.mProj, this.mView);

      var lo = [1e9, 1e9], hi = [-1e9, -1e9];
      for (i = 0; i < corners.length; i++) {
        var c = corners[i];
        var m = this.mVP;
        var w = m[3] * c[0] + m[7] * c[1] + m[11] * c[2] + m[15];
        if (w < 1e-4) continue;
        var nx = (m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12]) / w;
        var ny = (m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13]) / w;
        if (nx < lo[0]) lo[0] = nx;
        if (nx > hi[0]) hi[0] = nx;
        if (ny < lo[1]) lo[1] = ny;
        if (ny > hi[1]) hi[1] = ny;
      }
      if (lo[0] > hi[0]) break;

      /* Projected size shrinks as 1/distance, so the correction is a
         straight ratio — hence how fast this settles. */
      var halfX = (hi[0] - lo[0]) * 0.5;
      var halfY = (hi[1] - lo[1]) * 0.5;
      dist *= Math.max(halfX / fillX, halfY / fillY);

      /* Re-aim so the bounds sit centred across, and a little low down:
         the wordmark takes the top of the frame. */
      var offX = (hi[0] + lo[0]) * 0.5;
      var offY = (hi[1] + lo[1]) * 0.5 + lerp(0.14, 0.05, tall) + squat * 0.10;
      var half = Math.tan(FOV * 0.5) * dist;
      /* Screen right and up, in world, for the current camera. */
      var fwd = v3norm(v3sub(target, this.eye));
      var right = v3norm(v3cross(fwd, [0, 1, 0]));
      var up = v3cross(right, fwd);
      target = v3add(target, v3add(v3mul(right, offX * half * aspect),
        v3mul(up, offY * half)));
    }

    this.target = target;
    this.eye = v3add(target, v3mul(dir, dist));
    mPerspective(this.mProj, FOV, aspect, 0.05, 40);
    mLookAt(this.mView, this.eye, this.target, [0, 1, 0]);
    mMul(this.mVP, this.mProj, this.mView);
  };
  /* Occluder spheres approximating the animal, for the contact shadow and
     the ambient term. Twenty-two of them is enough that the shadow reads
     as a body rather than a blob. */
  Studio.prototype.updateOccluders = function () {
    var m = this.model, rig = m.rig, occ = this.occ, n = 0, i;
    var spine = m.spine;
    var picks = [0.06, 0.13, 0.20, 0.26, 0.32, 0.38, 0.44, 0.50, 0.58, 0.68, 0.80, 0.92];
    for (i = 0; i < picks.length && n < MAX_OCC; i++) {
      var bi = Math.round(picks[i] * (spine.count - 1));
      var b = rig.bones[spine.base + bi];
      var g = girthAt(spine.uOf(bi));
      var p = this.toWorld(b.P);
      occ[n * 4] = p[0]; occ[n * 4 + 1] = p[1]; occ[n * 4 + 2] = p[2];
      occ[n * 4 + 3] = Math.max(g.w, g.h) * 1.15;
      n++;
    }
    for (i = 0; i < m.limbs.length && n < MAX_OCC; i++) {
      var limb = m.limbs[i];
      var mid = rig.bones[limb.base + Math.floor(limb.count * 0.45)];
      var foot = rig.bones[limb.foot];
      var pm = this.toWorld(mid.P);
      occ[n * 4] = pm[0]; occ[n * 4 + 1] = pm[1]; occ[n * 4 + 2] = pm[2];
      occ[n * 4 + 3] = 0.036; n++;
      if (n >= MAX_OCC) break;
      var pf = this.toWorld(foot.P);
      occ[n * 4] = pf[0]; occ[n * 4 + 1] = pf[1]; occ[n * 4 + 2] = pf[2];
      occ[n * 4 + 3] = 0.030; n++;
    }
    this.occN = n;
  };

  Studio.prototype.toWorld = function (p) {
    var m = this.mModel;
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  };

  /*
   * Where the head has to point, solved rather than tuned.
   *
   * The animal stands three-quarters on, so "looking at the visitor" is
   * not a fixed angle: it depends on where the camera ended up, which in
   * turn depends on the shape of the window. Aim at a point on the plane
   * of the screen — dead centre of the lens when the pointer is at rest —
   * and the stare comes out right on any aspect ratio.
   *
   * Measured from the rest pose, not the posed one, so the head cannot
   * chase its own motion round in circles.
   */
  Studio.prototype.gazeAngles = function () {
    var head = this.model.rig.bones[this.model.eyeBone].restPos;
    var hw = this.toWorld(head);

    /* Camera basis. */
    var fwd = v3norm(v3sub(this.target, this.eye));
    var right = v3norm(v3cross(fwd, [0, 1, 0]));
    var up = v3cross(right, fwd);

    var nx = clamp(this.gaze[0], -1.6, 1.6);
    var ny = clamp(this.gaze[1], -1.4, 1.4);
    var reach = 0.78;                       // metres of travel across the lens
    var tgt = v3add(this.eye, v3add(v3mul(right, nx * reach), v3mul(up, -ny * reach)));

    /* Back into model space — the model transform is a yaw and nothing
       else, so its inverse is the opposite yaw. */
    var dW = v3norm(v3sub(tgt, hw));
    var c = Math.cos(-this.modelYaw), s = Math.sin(-this.modelYaw);
    var dM = [dW[0] * c + dW[2] * s, dW[1], -dW[0] * s + dW[2] * c];

    var yaw = Math.atan2(dM[2], dM[0]);
    var pitch = Math.atan2(dM[1], Math.hypot(dM[0], dM[2]));
    return [clamp(yaw, -1.18, 1.18), clamp(pitch, -0.34, 0.40)];
  };

  Studio.prototype.frame = function () {
    var gl = this.gl;
    /*
     * One clock, read here. Mixing the rAF timestamp with performance.now()
     * yields a negative first delta — the frame timestamp predates the
     * moment the callback runs — and a negative dt runs every spring in the
     * behaviour backwards, which detonates them.
     */
    var now = (window.performance || Date).now();
    if (!this.last) this.last = now;
    var dt = (now - this.last) / 1000;
    this.last = now;
    dt = dt > 0.05 ? 0.05 : (dt < 0 ? 0 : dt);

    /* Camera and model transform first: the gaze solve reads both. */
    this.camera();

    var g = this.gazeAngles();
    this.beh.setTarget(g[0], g[1]);
    this.beh.step(dt);
    var root = this.beh.apply();
    this.model.rig.solve(root.q, root.p);

    /* Bone texture: position, rotation, scale. */
    var bones = this.model.rig.bones, i, W = this.boneW, D = this.boneData;
    for (i = 0; i < bones.length; i++) {
      var b = bones[i];
      D[i * 4] = b.P[0]; D[i * 4 + 1] = b.P[1]; D[i * 4 + 2] = b.P[2]; D[i * 4 + 3] = 1;
      var o1 = (W + i) * 4;
      D[o1] = b.Q[0]; D[o1 + 1] = b.Q[1]; D[o1 + 2] = b.Q[2]; D[o1 + 3] = b.Q[3];
      var o2 = (W * 2 + i) * 4;
      D[o2] = b.as[0]; D[o2 + 1] = b.as[1]; D[o2 + 2] = b.as[2]; D[o2 + 3] = 1;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.boneTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, 3, gl.RGBA, gl.FLOAT, D);

    this.updateOccluders();

    /* ---- scene pass ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
    gl.viewport(0, 0, this.SW, this.SH);
    gl.clearColor(0.97, 0.968, 0.962, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.progBack);
    gl.uniformMatrix4fv(this.progBack.u.uVP, false, this.mVP);
    gl.uniform3fv(this.progBack.u.uEye, this.eye);
    gl.uniform4fv(this.progBack.u.uOcc, this.occ);
    gl.uniform1i(this.progBack.u.uOccN, this.occN);
    gl.bindVertexArray(this.backVAO);
    gl.drawElements(gl.TRIANGLES, this.backCount, gl.UNSIGNED_INT, 0);

    gl.useProgram(this.progSkin);
    gl.uniformMatrix4fv(this.progSkin.u.uVP, false, this.mVP);
    gl.uniformMatrix4fv(this.progSkin.u.uModel, false, this.mModel);
    gl.uniformMatrix3fv(this.progSkin.u.uModelN, false, this.mNormal);
    gl.uniform3fv(this.progSkin.u.uEye, this.eye);
    gl.uniform4fv(this.progSkin.u.uOcc, this.occ);
    gl.uniform1i(this.progSkin.u.uOccN, this.occN);
    gl.uniform1f(this.progSkin.u.uWet, this.beh.flick > 0 ? 0.35 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.boneTex);
    gl.uniform1i(this.progSkin.u.uBones, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.uniform1i(this.progSkin.u.uScales, 1);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.skinCount, gl.UNSIGNED_INT, 0);

    /* ---- post ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.progPost);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.progPost.u.uScene, 0);
    gl.uniform2f(this.progPost.u.uTexel, 1 / this.W, 1 / this.H);
    gl.uniform1f(this.progPost.u.uTime, this.beh.t);
    gl.uniform1f(this.progPost.u.uGrain, 0.016);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);

    if (!this.ready) {
      this.ready = true;
      this.host.classList.add('is-gl', 'is-ready');
    }
  };

  /* Drop the render scale rather than the frame rate on slow hardware. */
  Studio.prototype.measure = function (ms) {
    this.frameSum += ms;
    this.frames++;
    if (this.frames < PERF_WINDOW) return;
    var avg = this.frameSum / this.frames;
    this.frames = 0; this.frameSum = 0;
    if (avg > PERF_BUDGET && this.scale > 0.55) {
      this.scale = Math.max(0.55, this.scale - 0.15);
      this.W = this.H = 0;
      this.resize();
    } else if (avg < PERF_BUDGET * 0.5 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.W = this.H = 0;
      this.resize();
    }
  };

  Studio.prototype.dispose = function () {
    var gl = this.gl;
    this.stop();
    if (!gl) return;
    var lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    this.gl = null;
  };

  Studio.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.last = 0;   // re-baselined on the next frame, so a long pause
                     // never arrives as one enormous time step
    var self = this;
    (function loop() {
      if (!self.running) return;
      self.raf = window.requestAnimationFrame(loop);
      var t0 = (window.performance || Date).now();
      self.resize();
      try {
        self.frame();
      } catch (e) {
        self.stop();
        return;
      }
      self.measure((window.performance || Date).now() - t0);
    })();
  };

  Studio.prototype.stop = function () {
    this.running = false;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  /* ================================================================== */
  /* 9. Mount                                                            */
  /* ================================================================== */

  var IDLE_AFTER = 4200;        // ms of no input before the gaze wanders
  var TILT_RANGE = 32;          // degrees of tilt mapped to full deflection
  var TILT_SETTLE = 1800;

  function splitLetters(el) {
    if (!el || el.dataset.kwadSplit === '1') return;
    var text = el.textContent;
    var frag = document.createDocumentFragment();
    var chars = Array.prototype.slice.call(text);
    var i, n = chars.length;
    for (i = 0; i < n; i++) {
      var span = document.createElement('span');
      span.className = 'kwad-soon__ch';
      span.textContent = chars[i];
      span.style.setProperty('--i', String(i));
      span.style.setProperty('--n', String(n));
      span.setAttribute('aria-hidden', 'true');
      frag.appendChild(span);
    }
    /* Keep the original string for anything that reads the page rather
       than looks at it. */
    var sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;' +
      'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';
    sr.textContent = text;
    el.textContent = '';
    el.appendChild(sr);
    el.appendChild(frag);
    el.dataset.kwadSplit = '1';
  }

  function mount(host) {
    if (host.dataset.kwadMounted === '1') return;
    host.dataset.kwadMounted = '1';

    var words = host.querySelectorAll('[data-kwad-split]');
    for (var wi = 0; wi < words.length; wi++) splitLetters(words[wi]);

    var canvas = document.createElement('canvas');
    canvas.className = 'kwad-soon__gl';
    /* The animal is decoration; the words are the content. */
    canvas.setAttribute('aria-hidden', 'true');
    var floor = host.querySelector('.kwad-soon__floor');
    if (floor) host.insertBefore(canvas, floor.nextSibling);
    else host.insertBefore(canvas, host.firstChild);

    var studio = new Studio(host, canvas);
    var ok = false;
    try {
      ok = studio.init();
    } catch (e) {
      ok = false;
      if (window.console && window.console.warn) window.console.warn(e.message);
    }
    if (!ok) {
      canvas.parentNode.removeChild(canvas);
      /* Still animate the wordmark — the page is not broken, it just has
         no lizard in it. */
      host.classList.add('is-ready');
      return;
    }

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    function applyReduce() {
      studio.beh.damp = (reduce && reduce.matches) ? 0.22 : 1;
    }
    applyReduce();
    if (reduce && reduce.addEventListener) reduce.addEventListener('change', applyReduce);

    /* ---- pointer ---------------------------------------------------- */
    var lastInput = 0, idleSeed = Math.random() * 100;

    function setGaze(nx, ny) {
      studio.gaze[0] = nx;
      studio.gaze[1] = ny;
    }

    function onPointer(ev) {
      var rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      var ny = ((ev.clientY - rect.top) / rect.height) * 2 - 1;
      lastInput = (window.performance || Date).now();
      setGaze(nx, ny);
    }

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });

    /* ---- device tilt ------------------------------------------------ */
    /*
     * On a handset the visitor moves the phone, not a cursor. Counter-
     * rotating against beta and gamma keeps the animal's eye line on the
     * person holding it, so tilting the handset never breaks the stare.
     */
    var tiltOn = false;
    var tiltBtn = host.querySelector('[data-kwad-tilt]');

    function onTilt(ev) {
      if (ev.beta === null && ev.gamma === null) return;
      var now = (window.performance || Date).now();
      if (now - lastInput < TILT_SETTLE) return;
      var gx = clamp((ev.gamma || 0) / TILT_RANGE, -1.5, 1.5);
      var gy = clamp(((ev.beta || 0) - 48) / TILT_RANGE, -1.5, 1.5);
      setGaze(-gx, -gy);
      if (tiltBtn) tiltBtn.classList.remove('is-visible');
    }

    function enableTilt() {
      if (tiltOn) return;
      tiltOn = true;
      window.addEventListener('deviceorientation', onTilt, { passive: true });
    }

    var needsGesture = typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function';

    if (typeof window.DeviceOrientationEvent !== 'undefined') {
      if (needsGesture) {
        if (tiltBtn) {
          tiltBtn.classList.add('is-visible');
          tiltBtn.addEventListener('click', function () {
            window.DeviceOrientationEvent.requestPermission().then(function (state) {
              if (state === 'granted') enableTilt();
              tiltBtn.classList.remove('is-visible');
            })['catch'](function () {
              tiltBtn.classList.remove('is-visible');
            });
          });
        }
      } else if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        enableTilt();
      }
    }

    /* ---- idle drift -------------------------------------------------- */
    /* With nobody around it stops staring at the lens and looks about,
       which is the difference between a model and an animal. */
    var idleRAF = 0;
    (function idle() {
      idleRAF = window.requestAnimationFrame(idle);
      var now = (window.performance || Date).now();
      if (now - lastInput < IDLE_AFTER) return;
      var t = now / 1000 + idleSeed;
      var k = smoothstep(0, 1, Math.min(1, (now - lastInput - IDLE_AFTER) / 2500));
      setGaze(fbm1(t * 0.13, 31) * 1.25 * k, fbm1(t * 0.11, 37) * 0.85 * k);
    })();

    /* ---- lifecycle --------------------------------------------------- */
    var visible = true, onScreen = true;

    function sync() {
      if (visible && onScreen) studio.start(); else studio.stop();
    }

    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
      sync();
    });

    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        sync();
      }, { threshold: 0.01 });
      io.observe(host);
    }

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      studio.stop();
    });

    window.addEventListener('pagehide', function () {
      studio.stop();
      if (idleRAF) window.cancelAnimationFrame(idleRAF);
    });

    studio.start();
  }

  function boot() {
    var hosts = document.querySelectorAll('[data-kwadzilla-soon]');
    for (var i = 0; i < hosts.length; i++) mount(hosts[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* Shopify's theme editor tears sections down and rebuilds them. */
  document.addEventListener('shopify:section:load', boot);
}());
