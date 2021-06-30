interface ClientOptions {
  src: string
  outDir: string
  language: 'js'|'ts'
  redux?: boolean
  indent?: '2'|'4'|'tab'
  semicolon?: boolean
}


type HttpMethod = 'get'|'put'|'post'|'delete'|'options'|'head'|'patch'
