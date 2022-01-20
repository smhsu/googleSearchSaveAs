/**
* @param {ArrayBuffer} buffer
*/
const parseBinaryPlist = function(buffer) {
  const debug = false;
  // check header
  const headerBytes = buffer.slice(0, 'bplist'.length);
  const header = new TextDecoder().decode(headerBytes);
  if (header !== 'bplist') {
    throw new Error("Invalid binary plist. Expected 'bplist' at offset 0.");
  }
  
  // Handle trailer, last 32 bytes of the file
  const trailer = new DataView(buffer.slice(buffer.byteLength - 32, buffer.byteLength));
  // 6 null bytes (index 0 to 5)
  const offsetSize = trailer.getUint8(6);
  if (debug) {
    console.log("offsetSize: " + offsetSize);
  }
  const objectRefSize = trailer.getUint8(7);
  if (debug) {
    console.log("objectRefSize: " + objectRefSize);
  }
  const numObjects = readUInt64BE(trailer, 8);
  if (debug) {
    console.log("numObjects: " + numObjects);
  }
  const topObject = readUInt64BE(trailer, 16);
  if (debug) {
    console.log("topObject: " + topObject);
  }
  const offsetTableOffset = readUInt64BE(trailer, 24);
  if (debug) {
    console.log("offsetTableOffset: " + offsetTableOffset);
  }
  
  // Handle offset table
  const offsetTable = [];
  
  for (let i = 0; i < numObjects; i++) {
    const offsetBytes = buffer.slice(offsetTableOffset + i * offsetSize, offsetTableOffset + (i + 1) * offsetSize);
    offsetTable[i] = readUInt(offsetBytes, 0);
    if (debug) {
      console.log("Offset for Object #" + i + " is " + offsetTable[i] + " [" + offsetTable[i].toString(16) + "]");
    }
  }
  
  // Parses an object inside the currently parsed binary property list.
  // For the format specification check
  // <a href="https://www.opensource.apple.com/source/CF/CF-635/CFBinaryPList.c">
  // Apple's binary property list parser implementation</a>.
  function parseObject(tableOffset) {
    const offset = offsetTable[tableOffset];
    const bufferView = new Uint8Array(buffer);
    const type = bufferView[offset];
    const objType = (type & 0xF0) >> 4; //First  4 bits
    const objInfo = (type & 0x0F);      //Second 4 bits
    switch (objType) {
      case 0x0:
      return parseSimple();
      case 0x1:
      return parseInteger();
      case 0x8:
      return parseUID();
      case 0x2:
      return parseReal();
      case 0x3:
      return parseDate();
      case 0x4:
      return parseData();
      case 0x5: // ASCII
      return parsePlistString();
      case 0x6: // UTF-16
      return parsePlistString(true);
      case 0xA:
      return parseArray();
      case 0xD:
      return parseDictionary();
      default:
      throw new Error("Unhandled type 0x" + objType.toString(16));
    }
    
    function parseSimple() {
      //Simple
      switch (objInfo) {
        case 0x0: // null
        return null;
        case 0x8: // false
        return false;
        case 0x9: // true
        return true;
        case 0xF: // filler byte
        return null;
        default:
        throw new Error("Unhandled simple type 0x" + objType.toString(16));
      }
    }
    
    function bufferToHexString(buffer) {
      const bufferView = new Uint8Array(buffer);
      let str = '';
      let i;
      for (i = 0; i < buffer.byteLength; i++) {
        if (bufferView[i] != 0x00) {
          break;
        }
      }
      for (; i < buffer.byteLength; i++) {
        const part = '00' + bufferView[i].toString(16);
        str += part.substr(part.length - 2);
      }
      return str;
    }
    
    function parseInteger() {
      const length = Math.pow(2, objInfo);
      const data = buffer.slice(offset + 1, offset + 1 + length);
      if (length === 16) {
        const str = bufferToHexString(data);
        return Number.parseInt(str, 16);
      }
      return data.reduce((acc, curr) => {
        acc <<= 8;
        acc |= curr & 255;
        return acc;
      });
    }
    
    function parseUID() {
      const length = objInfo + 1;
      return new UID(readUInt(buffer.slice(offset + 1, offset + 1 + length)));
    }
    
    function parseReal() {
      const length = Math.pow(2, objInfo);
      const realBuffer = buffer.slice(offset + 1, offset + 1 + length);
      if (length === 4) {
        return new DataView(realBuffer).getFloat32();
      }
      if (length === 8) {
        return new DataView(realBuffer).getFloat64();
      }
    }
    
    function parseDate() {
      if (objInfo != 0x3) {
        console.error("Unknown date type :" + objInfo + ". Parsing anyway...");
      }
      const dateBuffer = buffer.slice(offset + 1, offset + 9);
      return new Date(EPOCH + (1000 * new DataView(dateBuffer).getFloat64()));
    }
    
    function parseData() {
      const bufferView = new Uint8Array(buffer);
      let dataoffset = 1;
      let length = objInfo;
      if (objInfo == 0xF) {
        const int_type = bufferView[offset + 1];
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0x4: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        dataoffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      
      return buffer.slice(offset + dataoffset, offset + dataoffset + length);
    }
    
    function parsePlistString (isUtf16) {
      const bufferView = new Uint8Array(buffer);
      isUtf16 = isUtf16 || 0;
      let enc = "utf8";
      let length = objInfo;
      let stroffset = 1;
      if (objInfo == 0xF) {
        const int_type = bufferView[offset + 1];
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        stroffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      // length is String length -> to get byte length multiply by 2, as 1 character takes 2 bytes in UTF-16
      length *= (isUtf16 + 1);
      let plistString = buffer.slice(offset + stroffset, offset + stroffset + length);
      if (isUtf16) {
        plistString = swapBytes(plistString);
        enc = "utf-16";
      }
      return new TextDecoder(enc).decode(plistString);
    }
    
    function parseArray() {
      const bufferView = new Uint8Array(buffer);
      let length = objInfo;
      let arrayoffset = 1;
      if (objInfo == 0xF) {
        const int_type = bufferView[offset + 1];
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0xa: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        arrayoffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      const array = [];
      for (let i = 0; i < length; i++) {
        const objRef = readUInt(buffer.slice(offset + arrayoffset + i * objectRefSize, offset + arrayoffset + (i + 1) * objectRefSize));
        array[i] = parseObject(objRef);
      }
      return array;
    }
    
    function parseDictionary() {
      let length = objInfo;
      let dictoffset = 1;
      if (objInfo == 0xF) {
        const int_type = new Uint8Array(buffer)[offset + 1];
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0xD: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        dictoffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      if (debug) {
        console.log("Parsing dictionary #" + tableOffset);
      }
      const dict = {};
      for (let i = 0; i < length; i++) {
        const keyRef = readUInt(buffer.slice(offset + dictoffset + i * objectRefSize, offset + dictoffset + (i + 1) * objectRefSize));
        const valRef = readUInt(buffer.slice(offset + dictoffset + (length * objectRefSize) + i * objectRefSize, offset + dictoffset + (length * objectRefSize) + (i + 1) * objectRefSize));
        const key = parseObject(keyRef);
        const val = parseObject(valRef);
        if (debug) {
          console.log("  DICT #" + tableOffset + ": Mapped " + key + " to " + val);
        }
        dict[key] = val;
      }
      return dict;
    }
  }
  
  return [ parseObject(topObject) ];
};

/**
* 
* @param {ArrayBuffer} buffer 
* @param {number} start 
* @returns 
*/
function readUInt(buffer, start) {
  const bufferUint = new Uint8Array(buffer);
  start = start || 0;
  
  let l = 0;
  for (let i = start; i < bufferUint.length; i++) {
    l <<= 8;
    l |= bufferUint[i] & 0xFF;
  }
  return l;
}

/**
* we're just going to toss the high order bits because javascript doesn't have 64-bit ints
* @param {DataView} buffer 
* @param {number} start 
* @returns 
*/
function readUInt64BE(buffer, start) {
  return buffer.getUint32(start + 4, false);
}

function swapBytes(buffer) {
  const bufferView = new Uint8Array(buffer);
  const len = bufferView.length;
  for (let i = 0; i < len; i += 2) {
    const a = bufferView[i];
    bufferView[i] = bufferView[i+1];
    bufferView[i+1] = a;
  }
  return buffer;
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @return {string}
 */
const getHtmlFromWebarchive = function(arrayBuffer) {
  const obj = parseBinaryPlist(arrayBuffer);
  const mainResource = obj[0]["WebMainResource"];
  const encoding = mainResource.WebResourceTextEncodingName.toLowerCase();
  return new TextDecoder(encoding).decode(mainResource.WebResourceData);
}

/*
const fs = require("fs");
const bin = fs.readFileSync("/fakepath/Wikipedia.webarchive");
const html = getHtmlFromWebArchive(bin.buffer);
*/
