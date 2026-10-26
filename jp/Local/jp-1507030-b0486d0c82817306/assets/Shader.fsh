//
//  Shader.fsh
//  template
//
//  Created by Marc Flerackers on 1/23/17.
//

uniform sampler2D texture;

varying lowp vec4 colorVarying;
varying mediump vec2 uvVarying;

void main()
{
    gl_FragColor = texture2D(texture, uvVarying) * colorVarying;
}
