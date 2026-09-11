import type { Copy } from './types';

export const es: Copy = {
  lang: 'es',
  locale: 'es_ES',
  meta: {
    title: 'OpenMeet — voz, pantalla y chat desde la terminal, sin cuenta',
    description:
      'Reuniones de código abierto y entre pares desde la terminal: audio Opus, pantalla y cámara compartidas en H.264 por hardware, chat. Un solo binario de 12 MB, sin cuenta, sin navegador, con servidor propio si quieres. macOS y Windows.',
    ogAlt:
      'OpenMeet en una terminal: la conversación a la izquierda, los participantes con sus etiquetas de estado a la derecha',
    summary:
      'OpenMeet es una aplicación de terminal de código abierto para llamadas de audio, pantalla y cámara compartidas y chat, en un solo binario de 12 MB. El audio y el vídeo viajan de par a par por WebRTC; el servidor solo transmite la negociación. No hace falta cuenta y el servidor se puede alojar en casa.',
    features: [
      'Audio Opus a 48 kHz con FEC en banda, codificado una sola vez para toda la sala',
      'Pantalla compartida en su propia proporción, hasta 1080 px de alto a 30 fps',
      'Cámara compartida hasta 720 px, en su propia pista junto a la pantalla, ambas en H.264 por hardware',
      'Chat de texto con los eventos de la sala en un solo hilo',
      'Volumen por participante, indicador de voz y latencia estimada',
      'Sin cuenta: un nombre y un color, elegidos una vez',
      'Malla WebRTC entre pares, hasta seis participantes',
      'Servidor de señalización sin base de datos, alojable en casa',
    ],
  },
  nav: {
    docs: 'Docs',
    github: 'GitHub',
    download: 'Descargar',
    selfHost: 'Servidor propio',
    switchLabel: 'Español',
    switchTitle: 'Leer esta página en español',
  },
  hero: {
    titlePlain: 'Sin cuenta. Sin navegador. Solo una terminal, una sala ',
    titleAccent: 'y tu voz.',
    lead: 'Llamadas Opus, pantalla y cámara compartidas y chat, de par a par, desde una terminal. Código abierto, con servidor propio si quieres, un solo binario de 12 MB, y tan ligera que olvidas que está abierta.',
    mac: 'macOS',
    windows: 'Windows',
    thatIsIt: 'eso es toda la instalación',
    note: 'Nada más que instalar. ffmpeg solo si quieres compartir pantalla o cámara.',
  },
  copy: { label: 'copiar', done: 'copiado' },
  tui: {
    title: 'openmeet · sala standup · 4 participantes',
    leave: 'salir',
    room: 'Sala',
    messages: {
      '00:25': 'buenas — ¿terminó la build de Windows?',
      '00:26': 'sí, menos de un minuto — ahora se compila cruzado desde el mac',
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
      title: 'Un binario, no una pestaña del navegador.',
      text: 'Las llamadas del audio corren en C, directo contra CoreAudio y WASAPI, y el micrófono se codifica una sola vez para toda la sala. Sin Electron, sin Chromium, sin runtime que instalar, sin una página web haciéndose pasar por aplicación.',
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
      title: 'Hecho para voces.',
      paragraphs: [
        'Opus a 48 kHz, codificado una sola vez y enviado a todos los de la sala, con FEC en banda para que un paquete perdido no sea una sílaba perdida. Una puerta de voz mantiene la línea en silencio mientras tú lo estás, que es la mayor parte de una llamada.',
        'Los dispositivos se abren a su frecuencia nativa y siguen al sistema cuando la cambia: unos auriculares Bluetooth que cambian de perfil a mitad de llamada se reabren, no se quedan robóticos. En macOS, el aislamiento de voz y la cancelación de eco de Apple vienen activados; Wave Link y NVIDIA Broadcast se reconocen y se ofrecen primero.',
      ],
      note: 'Volumen por participante, un punto de voz y una latencia estimada junto a cada nombre.',
      pane: {
        title: 'ajustes · audio',
        rows: [
          { k: 'Códec', v: 'Opus 48 kHz', tone: 'ok', note: '· 128 kbps por defecto, ajustable; un codificador para la sala' },
          {
            k: 'Pérdidas',
            v: 'FEC en banda',
            tone: 'ok',
            note: '+ ocultación — un paquete perdido no es una sílaba perdida',
          },
          { k: 'Puerta de voz', v: 'sí', tone: 'ok', note: '— el silencio no cuesta nada' },
          { k: 'Procesado', v: 'Apple', tone: 'ok', note: '(aislamiento de voz, cancelación de eco) · no' },
        ],
        bars: [
          { k: 'Frecuencia', v: '48 kHz' },
          { k: 'Trama', v: '20 ms' },
          { k: 'Codificadores', v: '1 por sala' },
        ],
        caption: 'Cada valor es un ajuste o una opción de línea de comandos:',
      },
    },
    video: {
      eyebrow: 'Pantalla y cámara',
      title: 'Comparte la pantalla. O la cámara. Las dos.',
      paragraphs: [
        'La pantalla compartida conserva su propia forma, hasta 1080 px de alto y 30 fps: un monitor ultrapanorámico sale a 2580×1080, sin bandas negras. La cámara sale hasta 720 px en su propia proporción.',
        'Cada una viaja en su propia pista WebRTC en H.264 del codificador de la GPU — VideoToolbox en el Mac, NVENC en Windows — codificada una sola vez y enviada a todos, así que compartir pantalla no interrumpe la cámara ni el audio, y el bitrate sigue al tamaño de la sala.',
      ],
      note: 'La cámara es de momento para macOS. Windows la tendrá antes de la 1.0.',
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
        'Un proceso, un binario. Las llamadas del audio se quedan en C y un solo codificador Opus alimenta a todos los participantes, así que una llamada cuesta lo mismo con dos personas que con seis: alrededor del 4% de un núcleo y 35 MB con la interfaz incluida, y la interfaz solo dibuja las celdas que cambian.',
        'Aquí nada trae un navegador dentro. Opus corre en nativo, el vídeo se codifica en la GPU, la terminal dibuja texto, y el cliente entero es un binario de 12 MB — frente a los 479 MB de la aplicación de Discord y 1,4 GB de la de Chrome, antes de que ninguna de las dos abra una ventana.',
      ],
      pane: {
        title: 'instalado, en un mismo Mac',
        facts: [
          'un proceso: interfaz, audio y red',
          'en llamada: ~4% de un núcleo, 35 MB, sea cual sea la sala',
          'sin Electron, sin Chromium, sin runtime que instalar',
          'compartir pantalla: H.264 por hardware, 1,3% de un núcleo en la aplicación',
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
        a: 'Solo para compartir pantalla o cámara. El binario habla con CoreAudio y WASAPI por sí mismo, así que una llamada no necesita nada más.',
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
        a: 'Opus a 48 kHz con FEC en banda y ocultación contra la pérdida de paquetes, una puerta de voz para que el silencio no cueste nada, y en macOS el aislamiento de voz y la cancelación de eco de Apple por defecto. El bitrate es una opción.',
      },
    ],
  },
  footer: { madeBy: 'hecho por', changelog: 'Cambios', download: 'Descargar' },
};
