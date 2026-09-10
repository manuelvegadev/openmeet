import type { Copy } from './types';

export const es: Copy = {
  lang: 'es',
  locale: 'es_ES',
  meta: {
    title: 'OpenMeet — voz, pantalla y chat desde la terminal, sin cuenta',
    description:
      'Reuniones de código abierto y entre pares desde la terminal: audio Opus estéreo hasta 256 kbps, pantalla y cámara compartidas, chat. Sin cuenta, sin navegador, con servidor propio si quieres. macOS y Windows.',
    ogAlt: 'OpenMeet en una terminal: la conversación a la izquierda, los participantes con sus medidores a la derecha',
    summary:
      'OpenMeet es una aplicación de terminal de código abierto para llamadas de audio, pantalla y cámara compartidas y chat. El audio y el vídeo viajan de par a par por WebRTC; el servidor solo transmite la negociación. No hace falta cuenta y el servidor se puede alojar en casa.',
    features: [
      'Audio Opus estéreo a 48 kHz, hasta 256 kbps en cada sentido, protegido con RED',
      'Pantalla compartida en su propia proporción, hasta 1080 px de alto a 30 fps',
      'Cámara compartida hasta 720 px, en su propia pista junto a la pantalla',
      'Chat de texto con los eventos de la sala en un solo hilo',
      'Volumen por participante, medidores VU y latencia estimada',
      'Sin cuenta: un nombre y un color, elegidos una vez',
      'Malla WebRTC entre pares, hasta seis participantes',
      'Servidor de señalización sin base de datos, alojable en casa',
    ],
  },
  nav: {
    docs: 'Docs',
    github: 'GitHub',
    npm: 'npm',
    selfHost: 'Servidor propio',
    switchLabel: 'Español',
    switchTitle: 'Leer esta página en español',
  },
  hero: {
    titlePlain: 'Sin cuenta. Sin navegador. Solo una terminal, una sala ',
    titleAccent: 'y tu voz.',
    lead: 'Llamadas Opus estéreo, pantalla y cámara compartidas y chat, de par a par, desde una terminal. Código abierto, con servidor propio si quieres, y tan ligera que olvidas que está abierta.',
    thatIsIt: 'eso es toda la instalación',
    note: 'Node 22 o superior. ffmpeg solo si quieres compartir pantalla o cámara.',
  },
  copy: { label: 'copiar', done: 'copiado' },
  tui: {
    title: 'openmeet · sala standup · 4 participantes',
    leave: 'salir',
    room: 'Sala',
    messages: {
      '00:25': 'buenas — ¿terminó la build de Windows?',
      '00:26': 'sí, cuatro minutos en el i7. casi todo es recompilar wrtc',
      '00:28': 'hola. esta vez el audio llega limpio, nada de voz de robot',
      '00:30': 'bien. por aquí también desaparecieron los cortes',
      '00:31': 'os enseño la traza',
      '00:33':
        'ese pico del final es la cámara abriéndose — retiene el dispositivo un momento tras el SIGTERM, por eso fallaba una vista previa justo después de una llamada',
      '00:35': '¿entonces esperamos a que salga en vez de un temporizador?',
      '00:36': 'ya está — stopCapture solo resuelve cuando el capturador se ha ido de verdad',
      '00:38': 'perdón, llego tarde. otra vez tenía el micro en el dispositivo equivocado',
      '00:41': 'tranquila, seguimos con la ruta de captura',
      '00:42': 'por mí bien',
      '00:43': 'una pasada más a la documentación y etiqueto la versión',
    },
    events: { join: 'entró en la sala', screen: 'empezó a compartir pantalla', mute: 'silenciado' },
    keys: {
      mute: 'silenciar',
      devices: 'dispositivos',
      share: 'compartir',
      stopCam: 'parar cámara',
      select: 'elegir',
      vol: 'vol',
      cam: 'cámara',
      screen: 'pantalla',
      chat: 'chat',
    },
    placeholder: 'Escribe un mensaje...',
  },
  pillars: [
    {
      eyebrow: '01 · Privacidad',
      title: 'Tu audio nunca pasa por nuestro servidor.',
      text: 'El audio y el vídeo van de par a par por WebRTC. El servidor solo transmite la negociación, guarda las salas en memoria y las olvida cuando sale la última persona. Sin cuentas, sin base de datos, nada que filtrar.',
    },
    {
      eyebrow: '02 · Código abierto',
      title: 'MIT, en GitHub, todo.',
      text: 'El cliente, el servidor de señalización y el protocolo compartido viven en un solo repositorio. Lee cómo funciona la ruta de audio, ejecuta tú mismo las pruebas de rendimiento, o aloja el servidor en tu propia máquina con un archivo compose.',
    },
    {
      eyebrow: '03 · Rendimiento',
      title: 'Un bucle de audio nativo, no una pestaña del navegador.',
      text: 'El audio corre en su propio proceso, con una cadencia de 10 ms, directo contra CoreAudio y WASAPI. Sin Electron, sin Chromium, sin una página web haciéndose pasar por aplicación.',
    },
  ],
  stories: {
    account: {
      eyebrow: 'Enchufar y hablar',
      title: 'Nada que registrar.',
      paragraphs: [
        'El primer arranque pide un nombre de hasta ocho caracteres y un color. Esa es tu identidad: todos te ven como [mvega], en tu color, en la lista y en cada mensaje.',
        'Las salas son solo nombres. Escribe uno en el que no haya nadie y existe; sal y desaparece. Sin enlaces que generar, sin sala de espera, sin calendario.',
      ],
      note: 'Hasta seis personas por sala, cada una conectada directamente a las demás.',
      pane: {
        title: 'primer arranque · quién eres',
        pickName: 'Elige un nombre',
        pickColour: 'Elige un color',
        colours: ['blanco', 'rojo', 'amarillo', 'verde', 'azul', 'morado'],
        caption: 'Dos preguntas, una vez. Y dentro.',
      },
    },
    audio: {
      eyebrow: 'Audio',
      title: 'Se nota al oído.',
      paragraphs: [
        'Opus estéreo a 48 kHz, hasta 256 kbps en cada sentido. La mayoría de aplicaciones de reuniones te dan mono a una fracción de eso; esta deja que un micro estéreo, una interfaz o un juego suenen como suenan de tu lado.',
        'Los dispositivos se abren a su frecuencia nativa y se remuestrean en el propio proceso a unos 90 dB de SNR. La supresión de ruido es opcional, en la CPU o, en Windows con una RTX, mediante NVIDIA Broadcast.',
      ],
      note: 'Volumen por participante, medidores VU y una latencia estimada junto a cada nombre.',
      pane: {
        title: 'ajustes · audio',
        rows: [
          { k: 'Bitrate de envío', v: '' },
          { k: 'Bitrate de recepción', v: '' },
          { k: 'Canales', v: 'estéreo', tone: 'ok', note: '· mono · izq · der' },
          { k: 'Supresión de ruido', v: 'sí', tone: 'ok', note: '(RNNoise, 0,22 ms por trama)' },
          { k: 'Redundancia', v: 'RED', tone: 'ok', note: '— un paquete perdido no es una sílaba perdida' },
        ],
        bars: [
          { k: 'Frecuencia', v: '48 kHz' },
          { k: 'Trama', v: '10 ms' },
          { k: 'Techo', v: '256 kbps' },
        ],
        caption: 'Cada valor es un ajuste o una opción de línea de comandos:',
      },
    },
    video: {
      eyebrow: 'Pantalla y cámara',
      title: 'Comparte la pantalla. O la cámara. Las dos.',
      paragraphs: [
        'La pantalla compartida conserva su propia forma, hasta 1080 px de alto y 30 fps: un monitor ultrapanorámico sale a 2580×1080, sin bandas negras. La cámara sale hasta 720 px en su propia proporción.',
        'Cada una viaja en su propia pista WebRTC, así que compartir pantalla no interrumpe la cámara, y el techo de bitrate sigue al tamaño de la sala.',
      ],
      note: 'La cámara es de momento para macOS y Linux. Windows la tendrá antes de la 1.0.',
      pane: {
        title: 'sala · participantes',
        legend: [
          { tag: 'S', text: 'comparte pantalla ·' },
          { tag: 'C', text: 'tiene la cámara encendida ·' },
          { tag: 'm', text: 'está silenciado' },
        ],
        opens: 'la abre',
        caption: 'El vídeo se abre en su propia ventana, a la resolución de quien lo envía.',
      },
    },
    perf: {
      eyebrow: 'Rendimiento',
      title: 'Sin navegador de por medio.',
      paragraphs: [
        'El motor de audio es un proceso aparte que solo ve las llamadas del audio, la señalización y un sondeo de estadísticas. En una llamada de dos se queda en 65 MB y no se mueve en toda la llamada, así que la interfaz puede quedarse colgada un segundo y nadie lo oye.',
        'Aquí nada trae un navegador dentro. Opus, VP8 y el mezclador corren en nativo, la terminal dibuja texto, y el cliente entero se instala en 78 MB — frente a los 479 MB de la aplicación de Discord y 1,4 GB de la de Chrome, antes de que ninguna de las dos abra una ventana.',
      ],
      pane: {
        title: 'instalado, en un mismo Mac',
        facts: [
          'dos procesos: la interfaz y el motor de audio',
          'el motor de audio: 65 MB, planos toda la llamada',
          'sin Electron, sin Chromium, sin compositor en la GPU',
          'compartir un escritorio quieto cuesta ~3% de un núcleo (Windows, DDA)',
        ],
        caption:
          'Medido, no estimado: Apple M4 Pro, macOS 15, frente a Discord 0.0.411 y Chrome 152 tal y como se distribuyen.',
      },
    },
  },
  platforms: {
    eyebrow: 'Plataformas',
    title: 'macOS y Windows, hoy.',
    head: ['Plataforma', 'Estado', 'Qué funciona'],
    rows: [
      {
        name: 'macOS 15 o posterior',
        status: 'Compatible',
        ok: true,
        features: 'Audio, chat, cámara, pantalla compartida',
      },
      { name: 'Windows 11', status: 'Compatible', ok: true, features: 'Audio, chat, pantalla compartida' },
      { name: 'Linux', status: 'Limitado', ok: false, features: 'Funciona, sin garantías, sin pruebas' },
    ],
    roadmapEyebrow: 'Hoja de ruta',
    roadmapTitle: 'Lo que viene.',
    roadmap: [
      { when: 'v1.0', what: 'macOS y Windows con las mismas funciones', now: true },
      { when: 'después', what: 'Ubuntu y Fedora, con soporte' },
      { when: 'luego', what: 'un cliente web, para quien no tenga terminal' },
      { when: 'más tarde', what: 'Android' },
    ],
  },
  selfHost: {
    eyebrow: 'Servidor propio',
    title: 'O aloja el servidor tú mismo.',
    text: 'El servidor público es el predeterminado. El servidor de señalización es una aplicación Express sin base de datos, así que el tuyo está a un archivo compose de distancia.',
  },
  stack: { eyebrow: 'Hecho con', title: 'Nada exótico.' },
  faq: {
    eyebrow: 'Preguntas',
    title: 'Antes de instalar.',
    items: [
      {
        q: '¿Adónde va mi audio?',
        a: 'A las otras personas de la sala, directamente, por WebRTC. El servidor nunca ve el audio ni el vídeo, solo la negociación, y no guarda nada cuando la sala se vacía.',
      },
      {
        q: '¿Necesito una cuenta?',
        a: 'No. El primer arranque pide un nombre y un color, una sola vez. Las salas son nombres: escribe uno y existe.',
      },
      {
        q: '¿Necesito ffmpeg?',
        a: 'Solo para compartir pantalla o cámara. El audio habla con CoreAudio y WASAPI a través de un módulo nativo incluido, así que una llamada no necesita más que Node 22.',
      },
      {
        q: '¿Es gratis?',
        a: 'Sí. Licencia MIT, servidor público incluido. Aloja el tuyo si prefieres no confiar en el nuestro.',
      },
      {
        q: '¿Qué plataformas son compatibles?',
        a: 'macOS 15 o posterior y Windows 11 en hardware real. Linux funciona sin garantías y no se prueba activamente. El soporte para Ubuntu y Fedora, un cliente web y Android están en la hoja de ruta.',
      },
      {
        q: '¿Qué calidad tiene el audio?',
        a: 'Opus estéreo a 48 kHz, hasta 256 kbps en cada sentido, con redundancia RED contra la pérdida de paquetes. La supresión de ruido es opcional.',
      },
    ],
  },
  footer: { madeBy: 'hecho por', changelog: 'Cambios' },
};
