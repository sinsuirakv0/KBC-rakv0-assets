//
//  Shader.vsh
//  template
//
//  Created by Marc Flerackers on 1/23/17.
//

attribute vec2 position;
attribute vec4 color;
attribute vec2 uv;

varying lowp vec4 colorVarying;
varying lowp vec2 uvVarying;

uniform mat4 projection;
uniform mat4 modelview;
uniform float pointSize;

void main()
{
    colorVarying = color;
    uvVarying = uv;
    gl_PointSize = pointSize;
    gl_Position = projection * modelview * vec4(position, 0.0, 1.0);
}
