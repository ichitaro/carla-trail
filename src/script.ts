import './style.css'
import * as THREE from 'three'
import WebGL from 'three/examples/jsm/capabilities/WebGL'
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils'
import Experience, { isDebug } from './utils/Experience'
import assets from './utils/assets'
import customizeMaterial from './utils/customizeMaterial'
import getIndicesForRandomEdges from './scene/utils/getIndicesForRandomEdges'
import lerpDelta from './scene/utils/lerpDelta'
import { addLights } from './scene/lights'
import skinnedMeshVertexShader from './shaders/skinnedMesh/vertex.glsl'
import skinnedMeshFragmentShader from './shaders/skinnedMesh/fragment.glsl'
import historyInitShader from './shaders/history/init.glsl'
import historyRotateShader from './shaders/history/rotate.glsl'

if (WebGL.isWebGL2Available() === false) {
  document.body.appendChild(WebGL.getWebGL2ErrorMessage())
  throw new Error('Your graphics card does not seem to support WebGL 2')
}

const webgl = new Experience({
  clearColor: '#ffd9cf',
  renderer: {
    canvas: document.querySelector('canvas.webgl') as HTMLCanvasElement,
  },
  orbitControls: true,
  stats: isDebug,
  gui: true,
})

if (webgl.gui) {
  webgl.gui.close()
}

const loadingElement = document.querySelector('.loading') as HTMLDivElement
loadingElement.style.visibility = 'visible'

const modelKey = assets.queue('./models/carla.glb', (key) => {
  return assets.loaders.gltfLoader.loadAsync(key)
})

assets.loadQueued().then(() => {
  /**
   * Renderer
   */
  webgl.renderer.toneMapping = THREE.ACESFilmicToneMapping
  webgl.renderer.toneMappingExposure = 3.6

  /**
   * Camera
   */
  webgl.camera.fov = 35
  webgl.camera.near = 0.1
  webgl.camera.far = 15
  webgl.camera.updateProjectionMatrix()
  webgl.camera.position.set(-4, 0, 0)
  webgl.orbitControls!.target.y = 1
  webgl.orbitControls!.minDistance = 1
  webgl.orbitControls!.maxDistance = 6
  webgl.orbitControls!.minPolarAngle = 0
  webgl.orbitControls!.maxPolarAngle = Math.PI / 2 + 0.15
  // webgl.orbitControls!.enablePan = false
  webgl.orbitControls!.enableDamping = true

  if (isDebug && webgl.gui) {
    const clearColor = new THREE.Color(0, 0, 0)
    webgl.renderer.getClearColor(clearColor)
    webgl.gui
      .addColor(
        {
          clearColor,
        },
        'clearColor'
      )
      .onChange((color: THREE.Color) => {
        webgl.renderer.setClearColor(color)
      })
    webgl.gui.add(webgl.renderer, 'toneMapping', {
      No: THREE.NoToneMapping,
      Linear: THREE.LinearToneMapping,
      Reinhard: THREE.ReinhardToneMapping,
      Cineon: THREE.CineonToneMapping,
      ACESFilmic: THREE.ACESFilmicToneMapping,
    })
    webgl.gui
      .add(webgl.renderer, 'toneMappingExposure')
      .min(0.5)
      .max(10)
      .step(0.1)
    webgl.gui
      .add(webgl.camera, 'fov')
      .min(20)
      .max(75)
      .step(1)
      .onChange(() => {
        webgl.camera.updateProjectionMatrix()
      })
  }

  /**
   * Helpers
   */
  // webgl.scene.add(new THREE.GridHelper(8))
  // webgl.scene.add(new THREE.AxesHelper())

  /**
   * Floor
   */
  const shadowMaterial = new THREE.ShadowMaterial({
    color: new THREE.Color('#3a1412'),
  })
  if (isDebug && webgl.gui) {
    const folder = webgl.gui.addFolder('Floor')
    folder.addColor(shadowMaterial, 'color').name('shadowColor')
  }
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), shadowMaterial)
  plane.rotation.x = -Math.PI / 2
  plane.receiveShadow = true
  webgl.scene.add(plane)

  addMain()
  addLights()

  /**
   * Toggle animation
   */
  if (webgl.gui) {
    const checkbox = webgl.gui
      .add({ pause: false }, 'pause')
      .onChange((value: boolean) => {
        webgl.isAnimationActive = !value
      })
    window.addEventListener('keyup', (event) => {
      if (event.key === ' ') {
        checkbox.setValue(!checkbox.getValue())
      }
    })
  }

  /**
   * Start render loop
   */
  setTimeout(() => {
    loadingElement.style.visibility = 'hidden'
    webgl.start()
  }, 500)
})

/**
 * This demo is implemented in 3 steps.
 * 1. Write SkinnedMesh vertex positions to texture.
 * 2. Save those positions for 60 frames to the texture.
 * 3. Create the triangles geometry, then set the positions and normals with the vertex shader by referencing the texture in step2.
 */
function addMain() {
  const glbRoot = assets.get<any>(modelKey)

  /**
   * Create an object that bakes the transformed vertex positions of the SinnedMesh into textures
   */
  const vertexStore = prepareSkinnedMeshSampler(glbRoot.scene)

  /**
   * History pass
   */
  const positionHistoryPass = createHistoryPass({
    numFrames: 60,
    numVertices: vertexStore.numVertices,
    srcMapWidth: vertexStore.mapWidth,
    srcMapHeight: vertexStore.mapHeight,
    srcMap: vertexStore.positionMap,
  })

  /**
   * AnimationMixer
   */
  const mixer = new THREE.AnimationMixer(glbRoot.scene)
  mixer.timeScale = 1
  mixer.clipAction(glbRoot.animations[2]).play()

  if (webgl.gui) {
    const folder = webgl.gui.addFolder('Animation')
    const options = {
      FastRun: 0,
      Dancing: 1,
      NorthernSoulSpinCombo: 2,
    }
    folder
      .add({ animation: 2 }, 'animation', options)
      .onChange((index: number) => {
        mixer.stopAllAction()
        mixer.clipAction(glbRoot.animations[index]).play()
        positionHistoryPass.setNeedsReset()
      })
    folder.add(mixer, 'timeScale').min(0).max(2).step(0.01)
  }

  const { geometry: ribbonGeometry, setDrawDensity: setRibbonsDensity } =
    createRibbonsGeometry(vertexStore.geometry, positionHistoryPass.numFrames)

  const drawAmount = { value: 0.5 }
  setRibbonsDensity(drawAmount.value)
  if (webgl.gui) {
    const folder = webgl.gui.addFolder('Performance')
    folder
      .add(drawAmount, 'value')
      .min(0)
      .max(1)
      .step(0.01)
      .name('drawAmount')
      .onChange(setRibbonsDensity)
  }

  const uniforms = {
    uPositionHistoryMap: {
      value: null! as THREE.Texture,
    },
    uHistoryMapSize: {
      value: new THREE.Vector2(
        positionHistoryPass.mapWidth,
        positionHistoryPass.mapHeight
      ),
    },
  }

  const { material } = customizeMaterial(
    new THREE.MeshStandardMaterial({
      flatShading: true,
      metalness: 0.36,
      roughness: 0.0,
      envMapIntensity: 0.4,
      map: vertexStore.diffuseMap,
      side: THREE.DoubleSide,
    }),
    uniforms,
    customizeRibbonsShader
  )
  if (webgl.gui) {
    const folder = webgl.gui.addFolder('Material')
    folder.add(material, 'metalness').min(0).max(1).step(0.01)
    folder.add(material, 'roughness').min(0).max(1).step(0.01)
    folder.add(material, 'envMapIntensity').min(0).max(10).step(0.01)
  }

  const { material: depthMaterial } = customizeMaterial(
    new THREE.MeshDepthMaterial({
      side: THREE.DoubleSide,
      depthPacking: THREE.RGBADepthPacking,
    }),
    uniforms,
    customizeRibbonsShader
  )

  const mesh = new THREE.Mesh(ribbonGeometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.customDepthMaterial = depthMaterial
  webgl.scene.add(mesh)

  const mouse3D = createMouse3D()
  mouse3D.setPosition(new THREE.Vector3(0, 0, 1))

  webgl.events.tick.on((deltaTime) => {
    mouse3D.update(deltaTime)

    mixer.update(deltaTime)
    vertexStore.update()

    const shift = positionHistoryPass.uniforms.uShift.value
    shift.copy(mouse3D.position)
    shift.multiplyScalar(-0.05 * deltaTime * 60)
    shift.y = 0
    positionHistoryPass.update()

    mesh.position.set(mouse3D.smoothPosition.x, 0, mouse3D.smoothPosition.z)
    mesh.position.multiplyScalar(0.5)

    uniforms.uPositionHistoryMap.value = positionHistoryPass.getCurrentMap()
  })
}

//----------------------------------------------------------
function prepareSkinnedMeshSampler(model: THREE.Group) {
  /**
   * Find the SkinnedMesh
   */
  let skinnedMesh: THREE.SkinnedMesh = null!
  model.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh) {
      skinnedMesh = child
    }
  })

  if (!skinnedMesh) throw new Error('SkinnedMesh not found')

  if (Array.isArray(skinnedMesh.material)) {
    throw new Error('Array material is not supported')
  }

  const diffuseMap: THREE.Texture = (skinnedMesh.material as any).map
  if (!diffuseMap) throw new Error('diffuseMap not found')

  const newGeometry = mergeVertices(skinnedMesh.geometry)

  /**
   * We want to store the animated vertex positions of the SkinnedMesh
   * as the render target textures and use them in the next pass.
   */
  const vertexStore = createVertexStore(newGeometry)

  const container = new THREE.Group()
  container.scale.multiplyScalar(0.01)
  container.add(model)
  vertexStore.scene.add(container)

  skinnedMesh.geometry.dispose()
  skinnedMesh.geometry = vertexStore.geometry

  skinnedMesh.material.dispose()
  skinnedMesh.material = vertexStore.material

  // @ts-ignore
  skinnedMesh.isMesh = false
  // @ts-ignore
  skinnedMesh.isPoints = true

  return {
    ...vertexStore,
    diffuseMap,
  }
}

/**
 * Emulate the Transform Feedback of SkinnedMesh using the render target texture.
 * https://stackoverflow.com/questions/29053870/retrieve-vertices-data-in-three-js
 */
function createVertexStore(geometry: THREE.BufferGeometry) {
  const numVertices = geometry.attributes.position.count

  /**
   * Add a vertex attribute to find the 2D coordinates of the fragment
   * that will store the vertex position.
   * One vertex corresponds to one fragment.
   */
  const fragIndices = new Float32Array(numVertices)
  for (let i = 0; i < numVertices; i++) {
    fragIndices[i] = i
  }
  geometry.setAttribute(
    'aFragIndex',
    new THREE.Float32BufferAttribute(fragIndices, 1)
  )

  const mapWidth = 512
  const mapHeight = THREE.MathUtils.ceilPowerOfTwo(
    Math.ceil(numVertices / mapWidth)
  )
  const renderTarget = new THREE.WebGLRenderTarget(mapWidth, mapHeight, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  })

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMapWidth: {
        value: mapWidth,
      },
      uMapHeight: {
        value: mapHeight,
      },
    },
    vertexShader: skinnedMeshVertexShader,
    fragmentShader: skinnedMeshFragmentShader,
  })

  const scene = new THREE.Scene()

  return {
    numVertices,
    mapWidth,
    mapHeight,
    geometry,
    material,
    scene,
    positionMap: renderTarget.texture,
    update,
  }

  function update() {
    const { renderer, camera } = webgl
    const originalRenderTarget = renderer.getRenderTarget()
    renderer.setRenderTarget(renderTarget)
    renderer.render(scene, camera)
    renderer.setRenderTarget(originalRenderTarget)
  }
}

//----------------------------------------------------------
/**
 * An object that stores the vertex positions for multiple frames as a texture.
 * The shader behaves like a queue or JavaScript's unshift().
 * In addition to rotating the array, the vertex positions are moved for visual effect.
 */

type HistoryPassOptions = {
  numFrames: number
  mapWidth?: number

  numVertices: number
  srcMapWidth: number
  srcMapHeight: number
  srcMap: THREE.Texture
}

function createHistoryPass({
  numFrames,
  mapWidth = 1024,
  numVertices,
  srcMapWidth,
  srcMapHeight,
  srcMap,
}: HistoryPassOptions) {
  const numFragments = numVertices * numFrames
  const mapHeight = THREE.MathUtils.ceilPowerOfTwo(
    Math.ceil(numFragments / mapWidth)
  )
  const gpuCompute = new GPUComputationRenderer(
    mapWidth,
    mapHeight,
    webgl.renderer
  )
  if (webgl.renderer.capabilities.isWebGL2 === false) {
    gpuCompute.setDataType(THREE.HalfFloatType)
  }

  const initialHistoryMap = gpuCompute.createTexture()
  const historyVariable = gpuCompute.addVariable(
    'uHistoryMap',
    historyRotateShader,
    initialHistoryMap
  )
  gpuCompute.setVariableDependencies(historyVariable, [historyVariable])

  const uniforms = {
    uMap: {
      value: srcMap,
    },
    uMapSize: {
      value: new THREE.Vector2(srcMapWidth, srcMapHeight),
    },
    uNumFrames: {
      value: numFrames,
    },
    uShift: {
      value: new THREE.Vector3(),
    },
  }
  Object.assign(historyVariable.material.uniforms, uniforms)

  const error = gpuCompute.init()
  if (error !== null) {
    console.error(error)
  }

  const initShader = gpuCompute.createShaderMaterial(
    historyInitShader,
    uniforms
  )

  let shouldReset = true

  return {
    numFrames,
    numVertices,
    mapWidth,
    mapHeight,
    uniforms,
    update,
    getCurrentMap,
    setNeedsReset,
  }

  function init() {
    const currentRenderTarget =
      gpuCompute.getCurrentRenderTarget(historyVariable)
    const alternateRenderTarget =
      gpuCompute.getAlternateRenderTarget(historyVariable)
    gpuCompute.doRenderTarget(initShader, currentRenderTarget)
    gpuCompute.doRenderTarget(initShader, alternateRenderTarget)
  }

  function update() {
    if (shouldReset) {
      shouldReset = false
      init()
    }

    gpuCompute.compute()
  }

  function getCurrentMap() {
    return gpuCompute.getCurrentRenderTarget(historyVariable).texture
  }

  function setNeedsReset() {
    shouldReset = true
  }
}

//----------------------------------------------------------
/**
 * Create triangles for the final rendering.
 * One vertex of a triangle has 3 fragment indices of the position history texture.
 * One is to get its vertex position, the other two are to compute the normal.
 */
function createRibbonsGeometry(
  srcGeometry: THREE.BufferGeometry,
  numFrames: number
) {
  const srcUvs = srcGeometry.attributes.uv.array as Float32Array

  // Randomly picks edges from geometry
  const edgesIndices = getIndicesForRandomEdges(srcGeometry, 0.35).flat()
  // const edgesIndices = getIndicesForRandomEdges(srcGeometry, 1, 15).flat()

  const numEdges = edgesIndices.length / 2
  const numSeguments = numFrames - 1
  const numTriangles = numEdges * 2 * numSeguments
  const numVertices = 3 * numTriangles
  const positions = new Float32Array(numVertices * 3)
  const uvs = new Float32Array(numVertices * 2)
  for (let e = 0; e < numEdges; e++) {
    for (let f = 0; f < numSeguments; f++) {
      const segIndex = e * numSeguments + f

      const vertexIndex0 = edgesIndices[2 * e + 0]
      const vertexIndex1 = edgesIndices[2 * e + 1]

      const i0 = vertexIndex0 * numFrames + f
      const i1 = vertexIndex1 * numFrames + f
      const i2 = i0 + 1
      const i3 = i1 + 1

      const u0 = srcUvs[2 * vertexIndex0 + 0]
      const v0 = srcUvs[2 * vertexIndex0 + 1]
      const u1 = srcUvs[2 * vertexIndex1 + 0]
      const v1 = srcUvs[2 * vertexIndex1 + 1]

      /**
       * Triangle 1
       */
      positions[segIndex * 18 + 0] = i0
      positions[segIndex * 18 + 1] = i1
      positions[segIndex * 18 + 2] = i2

      positions[segIndex * 18 + 3] = i1
      positions[segIndex * 18 + 4] = i2
      positions[segIndex * 18 + 5] = i0

      positions[segIndex * 18 + 6] = i2
      positions[segIndex * 18 + 7] = i0
      positions[segIndex * 18 + 8] = i1

      uvs[segIndex * 12 + 0] = u0
      uvs[segIndex * 12 + 1] = v0

      uvs[segIndex * 12 + 2] = u1
      uvs[segIndex * 12 + 3] = v1

      uvs[segIndex * 12 + 4] = u0
      uvs[segIndex * 12 + 5] = v0

      /**
       * Triangle2
       */
      positions[segIndex * 18 + 9] = i1
      positions[segIndex * 18 + 10] = i3
      positions[segIndex * 18 + 11] = i2

      positions[segIndex * 18 + 12] = i3
      positions[segIndex * 18 + 13] = i2
      positions[segIndex * 18 + 14] = i1

      positions[segIndex * 18 + 15] = i2
      positions[segIndex * 18 + 16] = i1
      positions[segIndex * 18 + 17] = i3

      uvs[segIndex * 12 + 6] = u1
      uvs[segIndex * 12 + 7] = v1

      uvs[segIndex * 12 + 8] = u1
      uvs[segIndex * 12 + 9] = v1

      uvs[segIndex * 12 + 10] = u0
      uvs[segIndex * 12 + 11] = v0
    }
  }

  const geometry = new THREE.BufferGeometry()

  /**
   * Although the position attribute is used,
   * it is actually fragment indices of the position history texture.
   */
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

  let drawDensity = 1

  return {
    geometry,
    setDrawDensity,
  }

  function setDrawDensity(value: number) {
    if (drawDensity !== value) {
      drawDensity = value

      const numStrokes = Math.floor(numEdges * value)
      geometry.setDrawRange(0, numStrokes * numSeguments * 6)
    }
  }
}

function customizeRibbonsShader(shader: THREE.Shader) {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    /* glsl */ `
      #include <common>

      uniform sampler2D uPositionHistoryMap;
      uniform vec2 uHistoryMapSize;

      vec2 texCoordAt(int index, in vec2 size) {
        return vec2(
          float(index % int(size.x)) / size.x,
          float(index / int(size.x)) / size.y
        );
      }
    `
  )
  shader.vertexShader = shader.vertexShader.replace(
    '#include <uv_vertex>',
    /* glsl */ `
      #include <uv_vertex>

      vec3 worldPos0 = texture2D(
        uPositionHistoryMap,
        texCoordAt(int(position.x), uHistoryMapSize)
      ).xyz;
    `
  )
  shader.vertexShader = shader.vertexShader.replace(
    '#include <beginnormal_vertex>',
    /* glsl */ `
      #include <beginnormal_vertex>

      vec3 worldPos1 = texture2D(
        uPositionHistoryMap,
        texCoordAt(int(position.y), uHistoryMapSize)
      ).xyz;
      vec3 worldPos2 = texture2D(
        uPositionHistoryMap,
        texCoordAt(int(position.z), uHistoryMapSize)
      ).xyz;
      objectNormal = normalize(cross(worldPos1 - worldPos0, worldPos2 - worldPos0));
    `
  )
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    /* glsl */ `
      #include <begin_vertex>

      transformed = worldPos0;
    `
  )
}

//----------------------------------------------------------
function createMouse3D(lerpFactor = 0.1) {
  const { camera, pointer, events } = webgl
  const position = new THREE.Vector3(0, 0, 0.8)
  const smoothPosition = position.clone()
  const raycaster = new THREE.Raycaster()
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0))
  const intersectPoint = new THREE.Vector3()

  let pointerMoved = false
  events.pointermove.once(() => {
    pointerMoved = true
  })

  return {
    position,
    smoothPosition,
    update,
    setPosition,
  }

  function update(deltaTime: number) {
    if (!pointerMoved) return

    camera.updateMatrixWorld()
    raycaster.setFromCamera(pointer, camera)
    plane.normal.copy(camera.position).normalize()
    if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
      position.copy(intersectPoint)
    }

    smoothPosition.lerp(position, lerpDelta(lerpFactor, deltaTime))
  }

  function setPosition(newPosition: THREE.Vector3) {
    position.copy(newPosition)
    smoothPosition.copy(newPosition)
  }
}
