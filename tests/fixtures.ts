// Small PNG test pictures, made with ImageMagick, each with the SHA-256 of the
// grid the decoder should give: computed from the pixels ImageMagick itself
// reads from the file, laid over the paper colour as the decoder does. Between
// them they cover every colour type, 1 to 16 bits, Adam7, and stored, fixed
// and dynamic deflate blocks.
export const PAPER = 0x141414

export const FIXTURES = [
  {
    name: 'rgb',
    side: 64,
    width: 4,
    height: 2,
    sha256: 'f0b23e55e8e679dd21ddc28fca5ebb733b5f32888e292f934ced3df203029436',
    png: 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAGUlEQVQI1wXBAQEAAACCIKb33EAIVbCtqAOFoAt34+KUgQAAAABJRU5ErkJggg==',
  },
  {
    name: 'palette',
    side: 64,
    width: 3,
    height: 1,
    sha256: '26b17fb5c3ff1fd92e0949b73fc2ee5368fcb03cbbdbae99e5637c8932d5a235',
    png: 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAACVBMVEUAAAD/AAAAAP9Kpa2BAAAAAXRSTlMAQObYZgAAAAxJREFUCNdjYGRgAgAACQAElgTvJwAAAABJRU5ErkJggg==',
  },
  {
    name: 'grayalpha',
    side: 64,
    width: 2,
    height: 1,
    sha256: '2fbc967638c5088d163a84e50db798a7291fdcb00ab1aa2ad79274157a92a366',
    png: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAQAAAAOu2tCAAAAEUlEQVQI12NoYPj/////BgYAFvcE/R0kDh4AAAAASUVORK5CYII=',
  },
  {
    name: 'deep',
    side: 64,
    width: 2,
    height: 1,
    sha256: '7b5a0c4b56a937f3f9bbc1a0fb8cbe02ca9603c9a7d5f687e67903b7c3e16e21',
    png: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAFUlEQVQI12P4/5+BoaFBQODDB0ZGACW5BQFZrplsAAAAAElFTkSuQmCC',
  },
  {
    name: 'bits',
    side: 64,
    width: 8,
    height: 1,
    sha256: '7e5950ac70bd2a05fde5dd7bfe1338cec3cd841ff65ac3c5bcd9b971b06cd5e9',
    png: 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAABAQAAAADLe9LuAAAACklEQVQI12MIBQAAVwBWlc0HDgAAAABJRU5ErkJggg==',
  },
  {
    name: 'interlaced',
    side: 64,
    width: 9,
    height: 9,
    sha256: '776461bf661edf289a3346b2d78dc44078409236c81b136ed1e223b005282848',
    png: 'iVBORw0KGgoAAAANSUhEUgAAAAkAAAAJCAIAAAEY9KHRAAABEUlEQVQY0wEGAfn+AaDDRiHimwTnqtvKogEAFFboAgT9OgOVnBoHo7USFa0AJHjMoZf/AkUX1MQqWgLE2GAJZxQBrNIUti2Snmn0ItcBhkr6AwQG9i+3BvdCy18liO7NswFHlKPw4Es/CvEqBgEDX4Il5RXmw9DMAej+A0klMRE2GBlDF9QgoQMrPfri1PYZ8Dg37B0DLRDrst/ZIMgBDZoLAa7cH8ghaLChFOm5KAkdCejN3nE6Kkkc3vAVBAMwPvEo2DQEJwM2biDw2cn+Lr/32MnRA7n08fEDTBsAAPP26dYG+d/x7iTdYAB5IzwkBtvj+f7RBNziCOD1z/MTB/7LzOHL6OoI/w/jPR0KdOXB7NdOerrzN49tAAAAAElFTkSuQmCC',
  },
  {
    name: 'dynamic',
    side: 64,
    width: 16,
    height: 16,
    sha256: 'f80aea431aea61ccb7e33720d4f82dd851a1c9555f4a4be6de32ac1ef8171ad2',
    png: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAA20lEQVQoz42SOwqDQBCG1xcigoInELFSEMK23kAv6D1ibyHpthGEFCJ26YRIRMSNpljfRNe/mhm+b5oZJggCcDkIIfY6TcLvepGpDT41hURhy6rXss7Jsd0O8n9B51NXCudW5UrIRRBEceMX2CJD9ohex5XuOp9uBJGpj+jJCUWmXgRjWnASwoyCKSRUgTCjoLAlVVC5chGqXqMK76+2CFnnUAXCjEKObapAmFFoBzlu/BM6bnxy7+VwBbbixjugvfnSm9cosP366JRfQgjt9j0AB8BtNXjOFYTwByJEVxmXSdE1AAAAAElFTkSuQmCC',
  },
  {
    name: 'dynamic, averaged',
    side: 4,
    width: 4,
    height: 4,
    sha256: '21d75be0c11413d069feb263060cdef8fb983f94114c3caaea950b996c22954d',
    png: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAA20lEQVQoz42SOwqDQBCG1xcigoInELFSEMK23kAv6D1ibyHpthGEFCJ26YRIRMSNpljfRNe/mhm+b5oZJggCcDkIIfY6TcLvepGpDT41hURhy6rXss7Jsd0O8n9B51NXCudW5UrIRRBEceMX2CJD9ohex5XuOp9uBJGpj+jJCUWmXgRjWnASwoyCKSRUgTCjoLAlVVC5chGqXqMK76+2CFnnUAXCjEKObapAmFFoBzlu/BM6bnxy7+VwBbbixjugvfnSm9cosP366JRfQgjt9j0AB8BtNXjOFYTwByJEVxmXSdE1AAAAAElFTkSuQmCC',
  },
  {
    name: 'stored',
    side: 64,
    width: 8,
    height: 8,
    sha256: 'dd19dd09e0e646b06d66ec612a825d34d7a3ee321219979971bdab0c4093bcdc',
    png: 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAA00lEQVQIHQHIADf/ARNVrxT82v4I7TkG2Pr6Et8ITRP08y4SHAP3Hif2CAsYEgUL9t3d7hEBGfgGFvzsByEDAC0kJiXy4NT5KOgIASIGERUN4NbFAP7+Ayo/Cu0D0S4M4//7ARYCBvgFEQcE5wzo4AQG4Anp3SQ6KQALGe3eAu7w9gT6GzISLf4D+xEh9+AFGgn1CAEO3wTt2BgD7iDzDh0QAwYR6yIC8uTk9/raBRFP6+bs1BxABu8Z+gNyBh/1Gd8TFAbG49cVC/EcHvwF/fP8HQU0CVPT0wzbRgAAAABJRU5ErkJggg==',
  },
]

// 50000 x 50000 in its header, a few bytes of data: never to be inflated.
export const BOMB = 'iVBORw0KGgoAAAANSUhEUgAAw1AAAMNQCAIAAADEzaqdAAAADElEQVR4nGNgoAwAAABAAAG3NHzvAAAAAElFTkSuQmCC'

// Plain pictures for the pipeline tests: 64 x 32 and 32 x 64.
export const WIDE = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAUElEQVRYw+3PQQ3AIADAQMAHSvCE/+dE8LgsaRVc59l3/LmlAQ1oQAMa0IAGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa0IAGvPYBxFwBBmQIVAsAAAAASUVORK5CYII='
export const TALL = 'iVBORw0KGgoAAAANSUhEUgAAACAAAABACAIAAAD07OL5AAAANklEQVRYw+3NQQEAMAjEsDFdKMUsqLhfKqCpnX7JfvQOAAAAAAAAAAAAAAAAAAAAAAAAACDQAZWHAlWyaUT5AAAAAElFTkSuQmCC'
