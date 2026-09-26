


export function wildcardMatch(pattern, value, { nocase = false } = {}) {
  if (!pattern) return false;
  let p = String(pattern).replace(/\\/g, '/');
  let v = String(value || '').replace(/\\/g, '/');
  if (nocase) {
    p = p.toLowerCase();
    v = v.toLowerCase();
  }
  const regex = globToRegex(p);
  return regex.test(v);
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        
        
        re += '[\\s\\S]*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}
